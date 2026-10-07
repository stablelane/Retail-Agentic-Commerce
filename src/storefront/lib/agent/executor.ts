import "server-only";

import { parseToolCall, DEFAULT_TOOL_LIMIT, MAX_LINE_QUANTITY } from "@/lib/agent/tools";
import type { ToolArgs, ToolInvocation } from "@/lib/agent/tools";
import type {
  CartSummaryBlock,
  CartUpdateItem,
  ChatCartLine,
  ChatEventMap,
  ProductCarouselBlock,
  ProductTileData,
  UIBlock,
} from "@/lib/agent/types";
import { findTotal } from "@/lib/commerce/acp";
import { productImageSrc } from "@/lib/commerce/catalog";
import { callMcpTool } from "@/lib/commerce/mcp";
import { normalizeRecommendations } from "@/lib/commerce/mcp-protocol";
import {
  MerchantApiError,
  getCheckoutSession,
  getOrder,
  getProduct,
  listProducts,
  type OrderStatusResponse,
  type Product,
} from "@/lib/commerce/merchant";
import { PRODUCT_ID } from "@/lib/commerce/proxy-allowlist";
import { MOCK_USER } from "@/lib/commerce/user";

export interface ExecutorDeps {
  listProducts: typeof listProducts;
  getProduct: typeof getProduct;
  getOrder: typeof getOrder;
  getCheckoutSession: typeof getCheckoutSession;
  callMcpTool: typeof callMcpTool;
}

const DEFAULT_DEPS: ExecutorDeps = {
  listProducts,
  getProduct,
  getOrder,
  getCheckoutSession,
  callMcpTool,
};

/** Per-turn state shared by every tool call in one `/api/chat` request. */
export interface ExecutorContext {
  cart: { sessionId: string | null; items: ChatCartLine[] };
  /** True once a cart tool ran; ACP session totals are stale until the browser re-syncs. */
  cartChanged: boolean;
  signal?: AbortSignal;
  catalog?: Promise<Map<string, Product>>;
}

export interface ToolOutcome {
  ok: boolean;
  /** Compact JSON returned to the model (ids, names, cents, counts, status). */
  result: Record<string, unknown>;
  blocks: UIBlock[];
  cartUpdate?: ChatEventMap["cart_update"];
  error?: ChatEventMap["error"];
}

export function createExecutorContext(
  cart: ExecutorContext["cart"],
  signal?: AbortSignal
): ExecutorContext {
  return {
    cart: { sessionId: cart.sessionId, items: cart.items.map((item) => ({ ...item })) },
    cartChanged: false,
    ...(signal ? { signal } : {}),
  };
}

const CATALOG_MATCH_SUBTITLE = "Showing catalog matches";
const MAX_RECOMMENDATIONS = 3;
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "some",
  "show",
  "me",
  "any",
  "you",
  "have",
  "what",
  "want",
  "need",
  "looking",
  "find",
  "please",
  "something",
  "items",
  "products",
  "essentials",
]);

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function toTile(product: Product, reasoning?: string): ProductTileData {
  return {
    id: product.id,
    name: product.name,
    price: product.base_price,
    compareAtPrice: product.compare_at_price,
    imageUrl: productImageSrc(product.image_url),
    stockCount: product.stock_count,
    ...(product.category ? { category: product.category } : {}),
    ...(reasoning ? { reasoning: reasoning.slice(0, 300) } : {}),
  };
}

function compactTile(tile: ProductTileData): Record<string, unknown> {
  return {
    id: tile.id,
    name: tile.name,
    price_cents: tile.price,
    ...(tile.compareAtPrice ? { compare_at_price_cents: tile.compareAtPrice } : {}),
    ...(tile.category ? { category: tile.category } : {}),
    in_stock: (tile.stockCount ?? 1) > 0,
  };
}

function carousel(
  title: string,
  products: ProductTileData[],
  extra: Partial<Pick<ProductCarouselBlock, "subtitle" | "variant" | "recommendationRequestId">>
): ProductCarouselBlock {
  const block: ProductCarouselBlock = { type: "product_carousel", title, products };
  if (extra.subtitle) block.subtitle = extra.subtitle;
  if (extra.variant) block.variant = extra.variant;
  if (extra.recommendationRequestId) block.recommendationRequestId = extra.recommendationRequestId;
  return block;
}

function productOutcome(
  title: string,
  tiles: ProductTileData[],
  extra: Partial<Pick<ProductCarouselBlock, "subtitle" | "variant" | "recommendationRequestId">>
): ToolOutcome {
  if (tiles.length === 0) {
    return { ok: true, result: { products: [], message: "No matching products" }, blocks: [] };
  }
  return {
    ok: true,
    result: {
      products: tiles.map(compactTile),
      ...(extra.subtitle === CATALOG_MATCH_SUBTITLE ? { note: "keyword catalog match" } : {}),
    },
    blocks: [carousel(title, tiles, extra)],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(result: Record<string, unknown>, error?: ToolOutcome["error"]): ToolOutcome {
  return { ok: false, result, blocks: [], ...(error ? { error } : {}) };
}

function merchantUnavailable(): ToolOutcome {
  return failure(
    { error: "merchant_unavailable" },
    { code: "merchant_unavailable", message: "The store is temporarily unavailable." }
  );
}

/** Merchant tracking URLs come from server config; only allow http(s). */
function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
        .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token))
    ),
  ];
}

/** Case-insensitive keyword match over name, description and attributes (MCP fallback). */
export function matchCatalog(
  products: Iterable<Product>,
  query: string,
  category: string | undefined,
  limit: number
): Product[] {
  const tokens = tokenize(query);
  const pool = [...products].filter((product) => !category || product.category === category);
  const scored = pool
    .map((product, index) => {
      const haystack = [
        product.name,
        product.description ?? "",
        product.category ?? "",
        product.subcategory ?? "",
        ...product.attributes,
      ]
        .join(" ")
        .toLowerCase();
      const score = tokens.filter((token) => haystack.includes(token)).length;
      return { product, score, index };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.product);
  return (scored.length > 0 ? scored : category ? pool : []).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export function createExecutor(deps: ExecutorDeps = DEFAULT_DEPS) {
  function loadCatalog(ctx: ExecutorContext): Promise<Map<string, Product>> {
    if (!ctx.catalog) {
      ctx.catalog = deps
        .listProducts({ limit: 100 })
        .then((list) => new Map(list.products.map((product) => [product.id, product])));
      ctx.catalog.catch(() => {
        delete ctx.catalog;
      });
    }
    return ctx.catalog;
  }

  async function hydrateCart(ctx: ExecutorContext): Promise<CartUpdateItem[]> {
    const catalog = await loadCatalog(ctx);
    const items: CartUpdateItem[] = [];
    for (const line of ctx.cart.items) {
      const product = catalog.get(line.id);
      if (!product) continue;
      const maxQuantity = Math.max(1, Math.min(MAX_LINE_QUANTITY, product.stock_count));
      items.push({
        id: product.id,
        name: product.name,
        price: product.base_price,
        imageUrl: productImageSrc(product.image_url),
        quantity: Math.min(line.quantity, maxQuantity),
        maxQuantity,
      });
    }
    return items;
  }

  async function sessionTotals(ctx: ExecutorContext): Promise<CartSummaryBlock["totals"]> {
    if (!ctx.cart.sessionId || ctx.cartChanged) return null;
    try {
      const session = await deps.getCheckoutSession(ctx.cart.sessionId);
      if (!session || session.status === "completed" || session.status === "canceled") return null;
      return session.totals.map(({ type, display_text, amount }) => ({
        type,
        display_text,
        amount,
      }));
    } catch {
      return null;
    }
  }

  async function cartOutcome(
    ctx: ExecutorContext,
    summary: Record<string, unknown>,
    emitUpdate: boolean
  ): Promise<ToolOutcome> {
    const items = await hydrateCart(ctx);
    const totals = await sessionTotals(ctx);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const block: CartSummaryBlock = {
      type: "cart_summary",
      items: items.map(({ id, name, price, quantity, imageUrl }) => ({
        id,
        name,
        price,
        quantity,
        imageUrl,
      })),
      totals,
      sessionId: ctx.cart.sessionId,
    };
    const total = totals ? findTotal(totals, "total") : null;
    return {
      ok: true,
      result: {
        ...summary,
        bag: {
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price_cents: item.price,
          })),
          item_count: items.reduce((sum, item) => sum + item.quantity, 0),
          subtotal_cents: subtotal,
          ...(total !== null ? { total_cents: total } : {}),
        },
      },
      blocks: [block],
      ...(emitUpdate ? { cartUpdate: { items, sessionId: ctx.cart.sessionId } } : {}),
    };
  }

  function setLine(ctx: ExecutorContext, productId: string, quantity: number): void {
    const items = ctx.cart.items.filter((item) => item.id !== productId);
    const index = ctx.cart.items.findIndex((item) => item.id === productId);
    if (quantity > 0) {
      items.splice(index === -1 ? items.length : index, 0, { id: productId, quantity });
    }
    ctx.cart.items = items;
    ctx.cartChanged = true;
  }

  // -- tools ---------------------------------------------------------------

  async function searchProducts(
    args: ToolArgs<"search_products">,
    ctx: ExecutorContext
  ): Promise<ToolOutcome> {
    const limit = args.limit ?? DEFAULT_TOOL_LIMIT;
    let tiles: ProductTileData[] = [];
    try {
      const response = await deps.callMcpTool(
        "search-products",
        { query: args.query, limit, ...(args.category ? { category: args.category } : {}) },
        ctx.signal
      );
      const raw = response.structuredContent?.products;
      if (!response.isError && Array.isArray(raw)) {
        const catalog = await loadCatalog(ctx).catch(() => null);
        const seen = new Set<string>();
        for (const entry of raw) {
          if (!isRecord(entry) || typeof entry.id !== "string" || !PRODUCT_ID.test(entry.id)) {
            continue;
          }
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          const product = catalog?.get(entry.id);
          if (product) {
            if (!args.category || product.category === args.category) tiles.push(toTile(product));
          } else if (
            !catalog &&
            typeof entry.name === "string" &&
            Number.isInteger(entry.basePrice)
          ) {
            tiles.push({
              id: entry.id,
              name: entry.name.slice(0, 200),
              price: entry.basePrice as number,
              compareAtPrice: null,
              imageUrl: productImageSrc(typeof entry.imageUrl === "string" ? entry.imageUrl : null),
              ...(Number.isInteger(entry.stockCount)
                ? { stockCount: entry.stockCount as number }
                : {}),
            });
          }
          if (tiles.length >= limit) break;
        }
      }
    } catch {
      // MCP unreachable or malformed: fall through to the catalog match.
    }
    if (tiles.length > 0) {
      return productOutcome(args.title, tiles, args.subtitle ? { subtitle: args.subtitle } : {});
    }

    try {
      const catalog = await loadCatalog(ctx);
      tiles = matchCatalog(catalog.values(), args.query, args.category, limit).map((p) =>
        toTile(p)
      );
    } catch (error) {
      if (error instanceof MerchantApiError) return merchantUnavailable();
      throw error;
    }
    return productOutcome(args.title, tiles, { subtitle: CATALOG_MATCH_SUBTITLE });
  }

  async function getRecommendations(
    args: ToolArgs<"get_recommendations">,
    ctx: ExecutorContext
  ): Promise<ToolOutcome> {
    const product = await deps.getProduct(args.product_id);
    if (!product) return failure({ error: "product_not_found", product_id: args.product_id });

    const catalog = await loadCatalog(ctx).catch(() => null);
    const cartItems = ctx.cart.items.flatMap((line) => {
      const entry = catalog?.get(line.id);
      return entry ? [{ productId: entry.id, name: entry.name, price: entry.base_price }] : [];
    });

    let tiles: ProductTileData[] = [];
    let requestId: string | null = null;
    try {
      const response = await deps.callMcpTool(
        "get-recommendations",
        {
          productId: product.id,
          productName: product.name,
          cartItems,
          sessionId: ctx.cart.sessionId,
        },
        ctx.signal
      );
      if (!response.isError) {
        const set = normalizeRecommendations(response.structuredContent, MAX_RECOMMENDATIONS);
        requestId = set.recommendationRequestId;
        const resolved = await Promise.all(
          set.recommendations
            .filter((rec) => rec.productId !== product.id)
            .map(async (rec) => {
              const match = catalog?.get(rec.productId) ?? (await deps.getProduct(rec.productId));
              return match ? toTile(match, rec.reasoning) : null;
            })
        );
        tiles = resolved.filter((tile): tile is ProductTileData => tile !== null);
      }
    } catch (error) {
      if (error instanceof MerchantApiError) return merchantUnavailable();
      // MCP unreachable: fall through to same-category items.
    }

    if (tiles.length > 0) {
      return productOutcome(args.title, tiles, {
        ...(args.subtitle ? { subtitle: args.subtitle } : {}),
        ...(requestId ? { recommendationRequestId: requestId } : {}),
      });
    }

    if (!catalog) return merchantUnavailable();
    const sameCategory = [...catalog.values()]
      .filter((entry) => entry.id !== product.id && entry.category === product.category)
      .slice(0, MAX_RECOMMENDATIONS)
      .map((entry) => toTile(entry));
    return productOutcome(args.title, sameCategory, { subtitle: CATALOG_MATCH_SUBTITLE });
  }

  async function listCatalog(
    args: ToolArgs<"list_catalog">,
    ctx: ExecutorContext
  ): Promise<ToolOutcome> {
    const catalog = await loadCatalog(ctx);
    const tiles = [...catalog.values()]
      .filter((product) => !args.category || product.category === args.category)
      .filter(
        (product) =>
          !args.on_sale_only ||
          (product.compare_at_price !== null && product.compare_at_price > product.base_price)
      )
      .filter((product) => !args.max_price_cents || product.base_price <= args.max_price_cents)
      .slice(0, args.limit ?? DEFAULT_TOOL_LIMIT)
      .map((product) => toTile(product));
    return productOutcome(args.title, tiles, args.subtitle ? { subtitle: args.subtitle } : {});
  }

  async function getProductDetails(args: ToolArgs<"get_product_details">): Promise<ToolOutcome> {
    const product = await deps.getProduct(args.product_id);
    if (!product) return failure({ error: "product_not_found", product_id: args.product_id });
    const tile = toTile(product);
    return {
      ok: true,
      result: {
        ...compactTile(tile),
        stock_count: product.stock_count,
        description: (product.description ?? "").slice(0, 240),
        attributes: product.attributes.slice(0, 8),
      },
      blocks: [carousel(product.name, [tile], { variant: "detail" })],
    };
  }

  async function addToCart(
    args: ToolArgs<"add_to_cart">,
    ctx: ExecutorContext
  ): Promise<ToolOutcome> {
    const product = await deps.getProduct(args.product_id);
    if (!product) return failure({ error: "product_not_found", product_id: args.product_id });
    if (product.stock_count <= 0) {
      return failure({ error: "out_of_stock", product_id: product.id, name: product.name });
    }
    const max = Math.min(MAX_LINE_QUANTITY, product.stock_count);
    const current = ctx.cart.items.find((item) => item.id === product.id)?.quantity ?? 0;
    const quantity = Math.min(current + (args.quantity ?? 1), max);
    setLine(ctx, product.id, quantity);
    return cartOutcome(
      ctx,
      {
        added: { id: product.id, name: product.name, quantity },
        ...(quantity === max && current + (args.quantity ?? 1) > max ? { capped_at: max } : {}),
      },
      true
    );
  }

  async function updateCart(
    args: ToolArgs<"update_cart">,
    ctx: ExecutorContext
  ): Promise<ToolOutcome> {
    const inBag = ctx.cart.items.some((item) => item.id === args.product_id);
    if (args.quantity === 0) {
      if (!inBag) return failure({ error: "not_in_bag", product_id: args.product_id });
      setLine(ctx, args.product_id, 0);
      return cartOutcome(ctx, { removed: args.product_id }, true);
    }
    const product = (await loadCatalog(ctx)).get(args.product_id);
    if (!product) return failure({ error: "product_not_found", product_id: args.product_id });
    if (product.stock_count <= 0) return failure({ error: "out_of_stock", product_id: product.id });
    const quantity = Math.min(args.quantity, MAX_LINE_QUANTITY, product.stock_count);
    setLine(ctx, product.id, quantity);
    return cartOutcome(ctx, { updated: { id: product.id, name: product.name, quantity } }, true);
  }

  async function startCheckout(ctx: ExecutorContext): Promise<ToolOutcome> {
    const itemCount = ctx.cart.items.reduce((sum, item) => sum + item.quantity, 0);
    if (itemCount === 0) return failure({ error: "empty_bag" });
    const totals = await sessionTotals(ctx);
    const total = totals ? findTotal(totals, "total") : null;
    return {
      ok: true,
      result: {
        checkout: "ready",
        item_count: itemCount,
        ...(total !== null ? { total_cents: total } : {}),
      },
      blocks: [{ type: "checkout_panel", sessionId: ctx.cart.sessionId, total, itemCount }],
    };
  }

  function orderStatusOutcome(order: OrderStatusResponse): ToolOutcome {
    const total = findTotal(order.totals, "total") ?? 0;
    const items = order.line_items.map((line) => ({
      name: line.name ?? line.item.id,
      quantity: line.item.quantity,
    }));
    return {
      ok: true,
      result: {
        order_id: order.id,
        status: order.status,
        estimated_delivery: order.estimated_delivery,
        carrier: order.fulfillment?.carrier_info ?? null,
        items,
        total_cents: total,
      },
      blocks: [
        {
          type: "order_status",
          orderId: order.id,
          status: order.status,
          statusHistory: order.status_history.map(({ status, at }) => ({ status, at })),
          estimatedDelivery: order.estimated_delivery,
          trackingUrl: safeHttpUrl(order.tracking_url),
          carrier: order.fulfillment?.carrier_info ?? null,
          items,
          total,
        },
      ],
    };
  }

  async function trackOrder(args: ToolArgs<"track_order">): Promise<ToolOutcome> {
    const email = args.email ?? MOCK_USER.email;
    if (!args.order_id) {
      return {
        ok: true,
        result: { status: "awaiting_order_id", message: "Showing an order lookup form" },
        blocks: [{ type: "order_form", prefill: { email }, reason: "missing_id" }],
      };
    }
    const order = await deps.getOrder(args.order_id, email);
    if (!order) {
      return {
        ok: false,
        result: { error: "order_not_found", order_id: args.order_id },
        blocks: [
          { type: "order_form", prefill: { orderId: args.order_id, email }, reason: "not_found" },
        ],
      };
    }
    return orderStatusOutcome(order);
  }

  function getAccount(): ToolOutcome {
    const { name, email, tier, loyaltyPoints, memberSince } = MOCK_USER;
    return {
      ok: true,
      result: { name, tier, loyalty_points: loyaltyPoints, member_since: memberSince },
      blocks: [{ type: "account_summary", name, email, tier, loyaltyPoints, memberSince }],
    };
  }

  async function dispatch(invocation: ToolInvocation, ctx: ExecutorContext): Promise<ToolOutcome> {
    switch (invocation.name) {
      case "search_products":
        return searchProducts(invocation.args, ctx);
      case "get_recommendations":
        return getRecommendations(invocation.args, ctx);
      case "list_catalog":
        return listCatalog(invocation.args, ctx);
      case "get_product_details":
        return getProductDetails(invocation.args);
      case "add_to_cart":
        return addToCart(invocation.args, ctx);
      case "update_cart":
        return updateCart(invocation.args, ctx);
      case "get_cart":
        return cartOutcome(ctx, {}, false);
      case "start_checkout":
        return startCheckout(ctx);
      case "track_order":
        return trackOrder(invocation.args);
      case "get_account":
        return getAccount();
    }
  }

  /** Validate untrusted tool arguments, then run the tool. Never throws. */
  async function execute(
    name: unknown,
    rawArgs: unknown,
    ctx: ExecutorContext
  ): Promise<ToolOutcome> {
    const parsed = parseToolCall(name, rawArgs);
    if (!parsed.ok) return failure({ error: "invalid_arguments", message: parsed.error });
    try {
      return await dispatch(parsed.invocation, ctx);
    } catch (error) {
      if (error instanceof MerchantApiError) return merchantUnavailable();
      return failure(
        { error: "tool_failed" },
        { code: "tool_failed", message: "Something went wrong. Please try again." }
      );
    }
  }

  return { execute };
}

export type ToolExecutor = ReturnType<typeof createExecutor>;
