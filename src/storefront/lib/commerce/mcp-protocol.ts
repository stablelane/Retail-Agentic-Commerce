/**
 * Apps SDK MCP helpers shared by the server proxy (`/api/mcp-proxy`) and the browser:
 * tool allow-list with argument validation, JSON-RPC/SSE envelope parsing, and
 * recommendation result normalisation.
 */

import { CHECKOUT_SESSION_ID, PRODUCT_ID } from "@/lib/commerce/proxy-allowlist";

export const MCP_TOOL_NAMES = ["get-recommendations", "track-recommendation-click"] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
/** Tools the server calls directly; `search-products` is not exposed through the proxy. */
export type McpServerToolName = McpToolName | "search-products";

export const RECOMMENDATION_SOURCES = ["storefront_pdp", "storefront_chat"] as const;
export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number];

const RECOMMENDATION_REQUEST_ID = /^rec_[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME_LENGTH = 200;
const MAX_CART_ITEMS = 50;

export type McpToolCall =
  | { ok: true; name: McpToolName; arguments: Record<string, unknown> }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function optionalSessionId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && CHECKOUT_SESSION_ID.test(value) ? value : undefined;
}

function validateRecommendationArgs(args: Record<string, unknown>): McpToolCall {
  const { productId, productName, cartItems = [], sessionId } = args;
  if (typeof productId !== "string" || !PRODUCT_ID.test(productId)) {
    return { ok: false, error: "Invalid productId" };
  }
  if (!isName(productName)) return { ok: false, error: "Invalid productName" };
  if (!Array.isArray(cartItems) || cartItems.length > MAX_CART_ITEMS) {
    return { ok: false, error: "Invalid cartItems" };
  }
  const items: Array<{ productId: string; name: string; price: number }> = [];
  for (const item of cartItems) {
    if (
      !isRecord(item) ||
      typeof item.productId !== "string" ||
      !PRODUCT_ID.test(item.productId) ||
      !isName(item.name) ||
      !Number.isInteger(item.price) ||
      (item.price as number) < 0
    ) {
      return { ok: false, error: "Invalid cartItems" };
    }
    items.push({ productId: item.productId, name: item.name, price: item.price as number });
  }
  const session = optionalSessionId(sessionId);
  if (session === undefined) return { ok: false, error: "Invalid sessionId" };
  return {
    ok: true,
    name: "get-recommendations",
    arguments: { productId, productName, cartItems: items, sessionId: session },
  };
}

function validateClickArgs(args: Record<string, unknown>): McpToolCall {
  const { productId, recommendationRequestId, sessionId, position, source } = args;
  if (typeof productId !== "string" || !PRODUCT_ID.test(productId)) {
    return { ok: false, error: "Invalid productId" };
  }
  if (
    typeof recommendationRequestId !== "string" ||
    !RECOMMENDATION_REQUEST_ID.test(recommendationRequestId)
  ) {
    return { ok: false, error: "Invalid recommendationRequestId" };
  }
  const session = optionalSessionId(sessionId);
  if (session === undefined) return { ok: false, error: "Invalid sessionId" };
  if (
    position !== undefined &&
    position !== null &&
    (!Number.isInteger(position) || (position as number) < 1 || (position as number) > 50)
  ) {
    return { ok: false, error: "Invalid position" };
  }
  if (!RECOMMENDATION_SOURCES.includes(source as RecommendationSource)) {
    return { ok: false, error: "Invalid source" };
  }
  return {
    ok: true,
    name: "track-recommendation-click",
    arguments: {
      productId,
      recommendationRequestId,
      sessionId: session,
      position: position ?? null,
      source,
    },
  };
}

/** Validate a `{ name, arguments }` body; returns a sanitized copy with only known keys. */
export function validateMcpToolCall(body: unknown): McpToolCall {
  if (!isRecord(body) || !isRecord(body.arguments)) {
    return { ok: false, error: "Expected { name, arguments }" };
  }
  switch (body.name) {
    case "get-recommendations":
      return validateRecommendationArgs(body.arguments);
    case "track-recommendation-click":
      return validateClickArgs(body.arguments);
    default:
      return { ok: false, error: "Tool not allowed" };
  }
}

/** Read a body as UTF-8 text, giving up (null) once it exceeds `maxBytes`. */
export async function readCappedText(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export interface McpToolResult {
  structuredContent: Record<string, unknown> | null;
  isError: boolean;
}

export class McpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpProtocolError";
  }
}

function toToolResult(envelope: unknown): McpToolResult {
  if (!isRecord(envelope)) throw new McpProtocolError("Malformed MCP response");
  if (isRecord(envelope.error)) {
    const message = typeof envelope.error.message === "string" ? envelope.error.message : "";
    throw new McpProtocolError(message || "MCP tool call failed");
  }
  if (!isRecord(envelope.result)) throw new McpProtocolError("MCP response has no result");
  const { structuredContent, isError } = envelope.result;
  return {
    structuredContent: isRecord(structuredContent) ? structuredContent : null,
    isError: isError === true,
  };
}

/** Data payloads of each SSE event; multi-line `data:` fields are joined with `\n`. */
function sseEventData(body: string): string[] {
  const events: string[] = [];
  let data: string[] = [];
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === "") {
      if (data.length > 0) events.push(data.join("\n"));
      data = [];
    } else if (line.startsWith("data:")) {
      data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
  }
  if (data.length > 0) events.push(data.join("\n"));
  return events;
}

/** Parse a JSON-RPC `tools/call` response delivered as JSON or as an SSE stream. */
export function parseMcpResponse(body: string, contentType: string | null): McpToolResult {
  if (contentType?.toLowerCase().includes("text/event-stream")) {
    let last: unknown = null;
    for (const payload of sseEventData(body)) {
      try {
        const data: unknown = JSON.parse(payload);
        if (isRecord(data) && ("result" in data || "error" in data)) last = data;
      } catch {
        // Ignore non-JSON events.
      }
    }
    if (last === null) throw new McpProtocolError("MCP stream ended without a result");
    return toToolResult(last);
  }
  try {
    return toToolResult(JSON.parse(body));
  } catch (error) {
    if (error instanceof McpProtocolError) throw error;
    throw new McpProtocolError("MCP response is not valid JSON");
  }
}

export interface Recommendation {
  productId: string;
  productName: string;
  rank: number;
  reasoning: string;
}

export interface RecommendationSet {
  recommendationRequestId: string | null;
  recommendations: Recommendation[];
}

/** Normalise `get-recommendations` structured content (agent output uses either key casing). */
export function normalizeRecommendations(
  content: Record<string, unknown> | null,
  limit = 3
): RecommendationSet {
  const raw = content && Array.isArray(content.recommendations) ? content.recommendations : [];
  const recommendations: Recommendation[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    if (!isRecord(entry)) return;
    const productId = entry.productId ?? entry.product_id;
    if (typeof productId !== "string" || !PRODUCT_ID.test(productId) || seen.has(productId)) {
      return;
    }
    seen.add(productId);
    const productName = entry.productName ?? entry.product_name;
    recommendations.push({
      productId,
      productName: typeof productName === "string" ? productName : "",
      rank: Number.isInteger(entry.rank) ? (entry.rank as number) : index + 1,
      reasoning: typeof entry.reasoning === "string" ? entry.reasoning : "",
    });
  });
  recommendations.sort((a, b) => a.rank - b.rank);
  const requestId = content?.recommendationRequestId;
  return {
    recommendationRequestId:
      typeof requestId === "string" && RECOMMENDATION_REQUEST_ID.test(requestId) ? requestId : null,
    recommendations: recommendations.slice(0, limit),
  };
}
