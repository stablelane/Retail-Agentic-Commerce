import {
  createExecutor,
  createExecutorContext,
  matchCatalog,
  type ExecutorDeps,
} from "@/lib/agent/executor";
import { parseToolCall } from "@/lib/agent/tools";
import { McpUnavailableError } from "@/lib/commerce/mcp";
import { MerchantApiError, type OrderStatusResponse, type Product } from "@/lib/commerce/merchant";

vi.mock("server-only", () => ({}));

function product(overrides: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sku: overrides.id.toUpperCase(),
    base_price: 2500,
    compare_at_price: null,
    stock_count: 100,
    min_margin: 0.2,
    image_url: `/${overrides.id}.jpeg`,
    category: "tops",
    subcategory: null,
    description: null,
    attributes: [],
    ...overrides,
  };
}

const CATALOG: Product[] = [
  product({ id: "prod_1", name: "Classic Tee", description: "Soft cotton tee" }),
  product({ id: "prod_2", name: "Slim Jeans", base_price: 6500, category: "bottoms" }),
  product({ id: "prod_3", name: "Graphic Tee", base_price: 3200, compare_at_price: 4000 }),
  product({
    id: "prod_4",
    name: "Trail Runner",
    base_price: 9900,
    category: "footwear",
    stock_count: 3,
    attributes: ["running", "breathable"],
  }),
  product({
    id: "prod_5",
    name: "Rain Shell",
    base_price: 12000,
    category: "outerwear",
    image_url: "https://evil.example/x.png",
  }),
];

const ORDER: OrderStatusResponse = {
  id: "order_abc123",
  checkout_session_id: "checkout_1",
  permalink_url: "https://example.com/orders/order_abc123",
  status: "order_shipped",
  status_history: [
    { status: "order_confirmed", at: "2026-10-07T10:00:00Z" },
    { status: "order_shipped", at: "2026-10-07T10:02:00Z" },
  ],
  placed_at: "2026-10-07T10:00:00Z",
  buyer: { first_name: "John", last_name: "Doe", email: "john@example.com", phone_number: null },
  line_items: [
    {
      id: "li_1",
      item: { id: "prod_1", quantity: 2 },
      name: "Classic Tee",
      base_amount: 5000,
      discount: 0,
      subtotal: 5000,
      tax: 0,
      total: 5000,
    },
  ],
  totals: [{ type: "total", display_text: "Total", amount: 5599 }],
  fulfillment_address: null,
  fulfillment: {
    option_id: "shipping_standard",
    title: "Standard",
    carrier_info: "USPS",
    earliest_delivery_time: null,
    latest_delivery_time: "2026-10-12T00:00:00Z",
  },
  tracking_url: "javascript:alert(1)",
  estimated_delivery: "2026-10-12T00:00:00Z",
};

function makeDeps(overrides: Partial<ExecutorDeps> = {}) {
  const deps = {
    listProducts: vi.fn<ExecutorDeps["listProducts"]>(async () => ({
      products: CATALOG,
      total: CATALOG.length,
      category: null,
    })),
    getProduct: vi.fn<ExecutorDeps["getProduct"]>(
      async (id) => CATALOG.find((entry) => entry.id === id) ?? null
    ),
    getOrder: vi.fn<ExecutorDeps["getOrder"]>(async (id, email) =>
      id === ORDER.id && email === "john@example.com" ? ORDER : null
    ),
    getCheckoutSession: vi.fn<ExecutorDeps["getCheckoutSession"]>(async () => null),
    callMcpTool: vi.fn<ExecutorDeps["callMcpTool"]>(async () => {
      throw new McpUnavailableError("down");
    }),
    ...overrides,
  };
  return deps;
}

function ctx(items: Array<{ id: string; quantity: number }> = [], sessionId: string | null = null) {
  return createExecutorContext({ sessionId, items });
}

describe("tool argument validation", () => {
  it.each([
    ["get_product_details", { product_id: "../../admin" }],
    ["get_product_details", { product_id: "prod_1", extra: true }],
    ["add_to_cart", { product_id: "prod_1", quantity: 11 }],
    ["add_to_cart", { product_id: "prod_1", quantity: 0 }],
    ["add_to_cart", { product_id: "PROD_1" }],
    ["update_cart", { product_id: "prod_1", quantity: -1 }],
    ["update_cart", { product_id: "prod_1" }],
    ["track_order", { order_id: "order_x/../../y" }],
    ["track_order", { email: "not-an-email" }],
    ["search_products", { query: "tee" }],
    ["search_products", { query: "tee", title: "Tees", category: "weapons" }],
    ["search_products", { query: "tee", title: "Tees", limit: 50 }],
    ["drop_database", {}],
  ])("rejects %s %j", (name, args) => {
    expect(parseToolCall(name, args).ok).toBe(false);
  });

  it("accepts JSON strings and treats nulls as omitted", () => {
    const parsed = parseToolCall(
      "search_products",
      '{"query":"tee","title":"Tees","category":null}'
    );
    expect(parsed).toEqual({
      ok: true,
      invocation: { name: "search_products", args: { query: "tee", title: "Tees" } },
    });
  });

  it("rejects malformed JSON", () => {
    expect(parseToolCall("get_cart", "{oops")).toEqual({
      ok: false,
      error: "Arguments are not valid JSON",
    });
  });

  it("never reaches the backend with invalid arguments", async () => {
    const deps = makeDeps();
    const outcome = await createExecutor(deps).execute(
      "get_product_details",
      { product_id: "prod_1?x=1" },
      ctx()
    );
    expect(outcome).toMatchObject({
      ok: false,
      result: { error: "invalid_arguments" },
      blocks: [],
    });
    expect(deps.getProduct).not.toHaveBeenCalled();
  });
});

describe("search_products", () => {
  it("maps MCP results and merges compare-at price/category from the catalog", async () => {
    const deps = makeDeps({
      callMcpTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          products: [
            { id: "prod_3", name: "Graphic Tee", basePrice: 3200, stockCount: 9 },
            { id: "prod_3", name: "dup", basePrice: 1 },
            { id: "javascript:alert(1)", name: "x", basePrice: 1 },
            { id: "prod_1", name: "Classic Tee", basePrice: 2500 },
          ],
        },
      })),
    });
    const outcome = await createExecutor(deps).execute(
      "search_products",
      { query: "tees", limit: 6, title: "Tees" },
      ctx()
    );
    expect(deps.callMcpTool).toHaveBeenCalledWith(
      "search-products",
      { query: "tees", limit: 6 },
      undefined
    );
    expect(outcome.blocks).toEqual([
      {
        type: "product_carousel",
        title: "Tees",
        products: [
          expect.objectContaining({
            id: "prod_3",
            price: 3200,
            compareAtPrice: 4000,
            category: "tops",
          }),
          expect.objectContaining({ id: "prod_1", price: 2500 }),
        ],
      },
    ]);
    expect(outcome.result).toEqual({
      products: [
        {
          id: "prod_3",
          name: "Graphic Tee",
          price_cents: 3200,
          compare_at_price_cents: 4000,
          category: "tops",
          in_stock: true,
        },
        { id: "prod_1", name: "Classic Tee", price_cents: 2500, category: "tops", in_stock: true },
      ],
    });
  });

  it("falls back to a catalog keyword match when MCP is unreachable", async () => {
    const outcome = await createExecutor(makeDeps()).execute(
      "search_products",
      { query: "running shoes", title: "Run" },
      ctx()
    );
    const block = outcome.blocks[0];
    expect(block).toMatchObject({ type: "product_carousel", subtitle: "Showing catalog matches" });
    expect(block?.type === "product_carousel" && block.products.map((p) => p.id)).toEqual([
      "prod_4",
    ]);
  });

  it("only serves local image paths", async () => {
    const outcome = await createExecutor(makeDeps()).execute(
      "list_catalog",
      { category: "outerwear", title: "Outerwear" },
      ctx()
    );
    const block = outcome.blocks[0];
    expect(block?.type === "product_carousel" && block.products[0]?.imageUrl).toBe("/prod_1.jpeg");
  });

  it("reports merchant outages", async () => {
    const deps = makeDeps({
      listProducts: vi.fn(async () => {
        throw new MerchantApiError("down", 502);
      }),
    });
    const outcome = await createExecutor(deps).execute(
      "search_products",
      { query: "tee", title: "Tees" },
      ctx()
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "merchant_unavailable" },
      result: { error: "merchant_unavailable" },
    });
  });
});

describe("list_catalog", () => {
  it("filters by sale status, price and limit", async () => {
    const executor = createExecutor(makeDeps());
    const sale = await executor.execute(
      "list_catalog",
      { on_sale_only: true, title: "Sale" },
      ctx()
    );
    expect(sale.result).toMatchObject({ products: [{ id: "prod_3" }] });

    const cheap = await executor.execute(
      "list_catalog",
      { max_price_cents: 3200, limit: 1, title: "Cheap" },
      ctx()
    );
    expect(cheap.result).toMatchObject({ products: [{ id: "prod_1" }] });
  });

  it("returns no block when nothing matches", async () => {
    const outcome = await createExecutor(makeDeps()).execute(
      "list_catalog",
      { category: "accessories", title: "Accessories" },
      ctx()
    );
    expect(outcome.blocks).toEqual([]);
    expect(outcome.result).toMatchObject({ products: [] });
  });
});

describe("get_recommendations", () => {
  it("uses the recommendation agent with cart context and keeps reasoning", async () => {
    const deps = makeDeps({
      callMcpTool: vi.fn(async () => ({
        isError: false,
        structuredContent: {
          recommendationRequestId: "rec_123",
          recommendations: [
            {
              productId: "prod_2",
              productName: "Slim Jeans",
              rank: 1,
              reasoning: "Classic pairing",
            },
            { productId: "prod_1", productName: "Classic Tee", rank: 2, reasoning: "self" },
          ],
        },
      })),
    });
    const outcome = await createExecutor(deps).execute(
      "get_recommendations",
      { product_id: "prod_1", title: "Pairs well" },
      ctx([{ id: "prod_3", quantity: 1 }], "checkout_abc")
    );
    expect(deps.callMcpTool).toHaveBeenCalledWith(
      "get-recommendations",
      {
        productId: "prod_1",
        productName: "Classic Tee",
        cartItems: [{ productId: "prod_3", name: "Graphic Tee", price: 3200 }],
        sessionId: "checkout_abc",
      },
      undefined
    );
    expect(outcome.blocks[0]).toMatchObject({
      type: "product_carousel",
      recommendationRequestId: "rec_123",
      products: [{ id: "prod_2", reasoning: "Classic pairing" }],
    });
  });

  it("falls back to same-category items when MCP is down", async () => {
    const outcome = await createExecutor(makeDeps()).execute(
      "get_recommendations",
      { product_id: "prod_1", title: "Pairs well" },
      ctx()
    );
    expect(outcome.blocks[0]).toMatchObject({
      subtitle: "Showing catalog matches",
      products: [{ id: "prod_3" }],
    });
  });

  it("reports unknown products", async () => {
    const outcome = await createExecutor(makeDeps()).execute(
      "get_recommendations",
      { product_id: "prod_999", title: "x" },
      ctx()
    );
    expect(outcome).toMatchObject({ ok: false, result: { error: "product_not_found" } });
  });
});

describe("cart tools", () => {
  it("add_to_cart validates, merges and caps quantity at stock", async () => {
    const context = ctx([{ id: "prod_4", quantity: 2 }]);
    const outcome = await createExecutor(makeDeps()).execute(
      "add_to_cart",
      { product_id: "prod_4", quantity: 5 },
      context
    );
    expect(context.cart.items).toEqual([{ id: "prod_4", quantity: 3 }]);
    expect(context.cartChanged).toBe(true);
    expect(outcome.cartUpdate).toEqual({
      sessionId: null,
      items: [
        {
          id: "prod_4",
          name: "Trail Runner",
          price: 9900,
          imageUrl: "/prod_4.jpeg",
          quantity: 3,
          maxQuantity: 3,
        },
      ],
    });
    expect(outcome.blocks[0]).toMatchObject({ type: "cart_summary", totals: null });
    expect(outcome.result).toMatchObject({
      capped_at: 3,
      bag: { item_count: 3, subtotal_cents: 29700 },
    });
  });

  it("add_to_cart rejects unknown products without touching the cart", async () => {
    const context = ctx();
    const outcome = await createExecutor(makeDeps()).execute(
      "add_to_cart",
      { product_id: "prod_404" },
      context
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.cartUpdate).toBeUndefined();
    expect(context.cart.items).toEqual([]);
  });

  it("update_cart with 0 removes the line", async () => {
    const context = ctx([
      { id: "prod_1", quantity: 1 },
      { id: "prod_2", quantity: 2 },
    ]);
    const outcome = await createExecutor(makeDeps()).execute(
      "update_cart",
      { product_id: "prod_1", quantity: 0 },
      context
    );
    expect(outcome.cartUpdate?.items.map((item) => item.id)).toEqual(["prod_2"]);
  });

  it("get_cart shows ACP totals when the session is current", async () => {
    const deps = makeDeps({
      getCheckoutSession: vi.fn(async () => ({
        status: "ready_for_payment",
        totals: [{ type: "total", display_text: "Total", amount: 3099 }],
      })) as unknown as ExecutorDeps["getCheckoutSession"],
    });
    const outcome = await createExecutor(deps).execute(
      "get_cart",
      {},
      ctx([{ id: "prod_1", quantity: 1 }], "checkout_abc")
    );
    expect(outcome.cartUpdate).toBeUndefined();
    expect(outcome.blocks[0]).toMatchObject({
      type: "cart_summary",
      sessionId: "checkout_abc",
      totals: [{ type: "total", amount: 3099 }],
    });
  });

  it("start_checkout needs a non-empty bag", async () => {
    const executor = createExecutor(makeDeps());
    expect(await executor.execute("start_checkout", {}, ctx())).toMatchObject({
      ok: false,
      result: { error: "empty_bag" },
    });
    const ready = await executor.execute(
      "start_checkout",
      {},
      ctx([{ id: "prod_1", quantity: 2 }])
    );
    expect(ready.blocks).toEqual([
      { type: "checkout_panel", sessionId: null, total: null, itemCount: 2 },
    ]);
  });
});

describe("track_order and get_account", () => {
  it("shows a form when the order id is missing", async () => {
    const outcome = await createExecutor(makeDeps()).execute("track_order", {}, ctx());
    expect(outcome.blocks).toEqual([
      { type: "order_form", prefill: { email: "john@example.com" }, reason: "missing_id" },
    ]);
  });

  it("renders order status and drops unsafe tracking URLs", async () => {
    const outcome = await createExecutor(makeDeps()).execute(
      "track_order",
      { order_id: "order_abc123" },
      ctx()
    );
    expect(outcome.blocks[0]).toEqual({
      type: "order_status",
      orderId: "order_abc123",
      status: "order_shipped",
      statusHistory: ORDER.status_history,
      estimatedDelivery: "2026-10-12T00:00:00Z",
      trackingUrl: null,
      carrier: "USPS",
      items: [{ name: "Classic Tee", quantity: 2 }],
      total: 5599,
    });
  });

  it("returns a prefilled form when the order is not found for that email", async () => {
    const outcome = await createExecutor(makeDeps()).execute(
      "track_order",
      { order_id: "order_abc123", email: "someone@else.com" },
      ctx()
    );
    expect(outcome.blocks).toEqual([
      {
        type: "order_form",
        prefill: { orderId: "order_abc123", email: "someone@else.com" },
        reason: "not_found",
      },
    ]);
  });

  it("returns the mock account", async () => {
    const outcome = await createExecutor(makeDeps()).execute("get_account", {}, ctx());
    expect(outcome.blocks[0]).toMatchObject({
      type: "account_summary",
      tier: "Gold",
      loyaltyPoints: 1250,
    });
  });
});

describe("matchCatalog", () => {
  it("ranks by token matches and respects category", () => {
    expect(matchCatalog(CATALOG, "soft cotton tee", undefined, 5).map((p) => p.id)).toEqual([
      "prod_1",
      "prod_3",
    ]);
    expect(matchCatalog(CATALOG, "anything", "bottoms", 5).map((p) => p.id)).toEqual(["prod_2"]);
    expect(matchCatalog(CATALOG, "zzz", undefined, 5)).toEqual([]);
  });
});
