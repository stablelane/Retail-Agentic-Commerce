import "server-only";

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";

import { CATEGORIES } from "@/lib/commerce/catalog";
import { ORDER_ID, PRODUCT_ID } from "@/lib/commerce/proxy-allowlist";

export const TOOL_NAMES = [
  "search_products",
  "get_recommendations",
  "list_catalog",
  "get_product_details",
  "add_to_cart",
  "update_cart",
  "get_cart",
  "start_checkout",
  "track_order",
  "get_account",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const MAX_LINE_QUANTITY = 10;
export const MAX_TOOL_LIMIT = 12;
export const DEFAULT_TOOL_LIMIT = 6;

const CATEGORY_IDS = CATEGORIES.map((category) => category.id) as [string, ...string[]];

/** Shown in the UI while the tool runs (§2.11 streaming behaviour). */
export const TOOL_LABELS: Record<ToolName, string> = {
  search_products: "Searching the catalog…",
  get_recommendations: "Finding recommendations…",
  list_catalog: "Browsing the catalog…",
  get_product_details: "Looking up the product…",
  add_to_cart: "Updating your bag…",
  update_cart: "Updating your bag…",
  get_cart: "Checking your bag…",
  start_checkout: "Preparing checkout…",
  track_order: "Checking your order…",
  get_account: "Loading your account…",
};

// ---------------------------------------------------------------------------
// Argument validation (model output is untrusted)
// ---------------------------------------------------------------------------

const productId = z.string().regex(PRODUCT_ID);
const title = z.string().trim().min(1).max(80);
const subtitle = z.string().trim().min(1).max(120);
const category = z.enum(CATEGORY_IDS);
const limit = z.number().int().min(1).max(MAX_TOOL_LIMIT);

export const TOOL_ARG_SCHEMAS = {
  search_products: z
    .object({
      query: z.string().trim().min(1).max(200),
      category: category.optional(),
      limit: limit.optional(),
      title,
      subtitle: subtitle.optional(),
    })
    .strict(),
  get_recommendations: z
    .object({ product_id: productId, title, subtitle: subtitle.optional() })
    .strict(),
  list_catalog: z
    .object({
      category: category.optional(),
      on_sale_only: z.boolean().optional(),
      max_price_cents: z.number().int().min(1).max(10_000_000).optional(),
      limit: limit.optional(),
      title,
      subtitle: subtitle.optional(),
    })
    .strict(),
  get_product_details: z.object({ product_id: productId }).strict(),
  add_to_cart: z
    .object({
      product_id: productId,
      quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).optional(),
    })
    .strict(),
  update_cart: z
    .object({ product_id: productId, quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY) })
    .strict(),
  get_cart: z.object({}).strict(),
  start_checkout: z.object({}).strict(),
  track_order: z
    .object({
      order_id: z.string().regex(ORDER_ID).optional(),
      email: z.string().trim().max(254).email().optional(),
    })
    .strict(),
  get_account: z.object({}).strict(),
} satisfies Record<ToolName, z.ZodTypeAny>;

export type ToolArgs<N extends ToolName> = z.infer<(typeof TOOL_ARG_SCHEMAS)[N]>;

export type ToolInvocation = {
  [N in ToolName]: { name: N; args: ToolArgs<N> };
}[ToolName];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

/** Models often send `null` for omitted optionals; treat those as absent. */
function dropNulls(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null));
}

export type ParsedToolCall =
  { ok: true; invocation: ToolInvocation } | { ok: false; error: string };

/** Validate a tool name and its arguments (object or JSON string). */
export function parseToolCall(name: unknown, rawArgs: unknown): ParsedToolCall {
  if (!isToolName(name)) return { ok: false, error: "Unknown tool" };
  let args: unknown = rawArgs ?? {};
  if (typeof args === "string") {
    if (args.length > 4000) return { ok: false, error: "Arguments too long" };
    try {
      args = args.trim() === "" ? {} : JSON.parse(args);
    } catch {
      return { ok: false, error: "Arguments are not valid JSON" };
    }
  }
  const result = TOOL_ARG_SCHEMAS[name].safeParse(dropNulls(args));
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`);
    return { ok: false, error: `Invalid arguments (${issues.join("; ")})` };
  }
  return { ok: true, invocation: { name, args: result.data } as ToolInvocation };
}

// ---------------------------------------------------------------------------
// OpenAI function schemas (§5.2)
// ---------------------------------------------------------------------------

const TITLE_PROPS = {
  title: { type: "string", maxLength: 80, description: "Short heading shown above the products" },
  subtitle: { type: "string", maxLength: 120, description: "Optional one-line subheading" },
} as const;

const CATEGORY_PROP = {
  type: "string",
  enum: CATEGORY_IDS,
  description: "Optional catalog category",
} as const;

const LIMIT_PROP = {
  type: "integer",
  minimum: 1,
  maximum: MAX_TOOL_LIMIT,
  description: `Max products to show (default ${DEFAULT_TOOL_LIMIT})`,
} as const;

const PRODUCT_ID_PROP = {
  type: "string",
  pattern: PRODUCT_ID.source,
  description: "Product id from a previous tool result, e.g. prod_1",
} as const;

function fn(
  name: ToolName,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = []
): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  fn(
    "search_products",
    "Semantic product search. Use for descriptive requests (occasions, styles, needs).",
    {
      query: { type: "string", maxLength: 200, description: "What the customer is looking for" },
      category: CATEGORY_PROP,
      limit: LIMIT_PROP,
      ...TITLE_PROPS,
    },
    ["query", "title"]
  ),
  fn(
    "get_recommendations",
    "Products that pair well with a given product (uses the current bag as context).",
    { product_id: PRODUCT_ID_PROP, ...TITLE_PROPS },
    ["product_id", "title"]
  ),
  fn(
    "list_catalog",
    "Browse the catalog by category, sale status or max price.",
    {
      category: CATEGORY_PROP,
      on_sale_only: { type: "boolean", description: "Only products with a compare-at price" },
      max_price_cents: { type: "integer", minimum: 1, description: "Max price in cents" },
      limit: LIMIT_PROP,
      ...TITLE_PROPS,
    },
    ["title"]
  ),
  fn(
    "get_product_details",
    "Full details (description, attributes, stock) for one product.",
    { product_id: PRODUCT_ID_PROP },
    ["product_id"]
  ),
  fn(
    "add_to_cart",
    "Add a product to the customer's bag.",
    {
      product_id: PRODUCT_ID_PROP,
      quantity: {
        type: "integer",
        minimum: 1,
        maximum: MAX_LINE_QUANTITY,
        description: "Default 1",
      },
    },
    ["product_id"]
  ),
  fn(
    "update_cart",
    "Set the quantity of a product in the bag; 0 removes it.",
    {
      product_id: PRODUCT_ID_PROP,
      quantity: { type: "integer", minimum: 0, maximum: MAX_LINE_QUANTITY },
    },
    ["product_id", "quantity"]
  ),
  fn("get_cart", "Show the customer's bag with prices."),
  fn("start_checkout", "Hand the customer off to the secure checkout page."),
  fn(
    "track_order",
    "Look up an order's shipping status. Omit order_id when unknown so the UI shows a lookup form.",
    {
      order_id: {
        type: "string",
        pattern: ORDER_ID.source,
        description: "Order id, e.g. order_abc123",
      },
      email: { type: "string", description: "Order email; defaults to the signed-in customer" },
    }
  ),
  fn("get_account", "Show the signed-in customer's loyalty tier and points."),
];
