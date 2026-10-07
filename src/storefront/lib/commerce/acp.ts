/**
 * Browser-safe ACP types and a fetch helper for the same-origin proxies
 * (`/api/proxy/merchant/*`, `/api/proxy/psp/*`), which attach the API keys server-side.
 */

export type CheckoutStatus =
  "not_ready_for_payment" | "ready_for_payment" | "completed" | "canceled";

export interface AcpItem {
  id: string;
  quantity: number;
}

export interface AcpBuyerInput {
  first_name: string;
  last_name?: string | null;
  email: string;
  phone_number?: string | null;
}

export interface AcpAddressInput {
  name: string;
  line_one: string;
  line_two?: string | null;
  city: string;
  state: string;
  country: string;
  postal_code: string;
}

export interface AcpPromotion {
  action: string;
  reason_codes: string[];
  reasoning: string;
}

export interface AcpLineItem {
  id: string;
  item: AcpItem;
  name: string | null;
  base_amount: number;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
  promotion?: AcpPromotion | null;
}

export interface AcpFulfillmentOption {
  type: "shipping" | "digital";
  id: string;
  title: string;
  subtitle: string;
  subtotal: number;
  tax: number;
  total: number;
  carrier_info?: string;
  earliest_delivery_time?: string;
  latest_delivery_time?: string;
}

export interface AcpTotal {
  type: string;
  display_text: string;
  amount: number;
}

export interface AcpAppliedDiscount {
  id: string;
  code: string | null;
  coupon: { id: string; name: string };
  amount: number;
}

export interface AcpRejectedDiscount {
  code: string;
  reason: string;
  message: string | null;
}

export interface AcpDiscounts {
  codes: string[];
  applied: AcpAppliedDiscount[];
  rejected: AcpRejectedDiscount[];
}

export interface AcpMessage {
  type: "info" | "warning" | "error";
  code?: string;
  param?: string | null;
  content: string;
}

export interface CheckoutSession {
  id: string;
  status: CheckoutStatus;
  currency: string;
  buyer: (AcpBuyerInput & { last_name: string | null }) | null;
  payment_provider?: { provider: string };
  line_items: AcpLineItem[];
  fulfillment_address: AcpAddressInput | null;
  fulfillment_options: AcpFulfillmentOption[];
  fulfillment_option_id: string | null;
  totals: AcpTotal[];
  discounts?: AcpDiscounts | null;
  messages: AcpMessage[];
  order?: { id: string; checkout_session_id: string; permalink_url: string } | null;
}

export interface CheckoutSessionPatch {
  items?: AcpItem[];
  buyer?: AcpBuyerInput;
  fulfillment_address?: AcpAddressInput;
  fulfillment_option_id?: string;
  discounts?: { codes: string[] };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class AcpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null
  ) {
    super(message);
    this.name = "AcpRequestError";
  }
}

const API_VERSION = process.env.NEXT_PUBLIC_API_VERSION || "2026-01-16";
const REQUEST_TIMEOUT_MS = 30_000;

/** Random id that also works outside secure contexts (no `crypto.randomUUID`). */
export function randomId(prefix: string): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readError(response: Response): Promise<AcpRequestError> {
  let message = `Request failed (${response.status})`;
  let code: string | null = null;
  try {
    const body: unknown = await response.json();
    const detail = isRecord(body) && isRecord(body.detail) ? body.detail : body;
    if (isRecord(detail)) {
      if (typeof detail.message === "string") message = detail.message;
      else if (typeof detail.error === "string") message = detail.error;
      if (typeof detail.code === "string") code = detail.code;
    }
  } catch {
    // Non-JSON error body; keep the generic message.
  }
  return new AcpRequestError(message, response.status, code);
}

interface ProxyRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  fetchImpl?: FetchLike | undefined;
}

/** Call a same-origin proxy path, e.g. `proxyRequest("merchant", "/checkout_sessions")`. */
export async function proxyRequest<T>(
  upstream: "merchant" | "psp",
  path: string,
  { method = "GET", body, fetchImpl }: ProxyRequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "API-Version": API_VERSION,
    "Request-Id": randomId("req"),
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = randomId("idem");
  }

  const doFetch = fetchImpl ?? ((input, init) => fetch(input, init));
  let response: Response;
  try {
    response = await doFetch(`/api/proxy/${upstream}${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : null,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AcpRequestError("The store is unreachable. Check your connection.", 0);
  }

  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

export function sessionPath(sessionId: string, action?: "complete" | "cancel"): string {
  const base = `/checkout_sessions/${encodeURIComponent(sessionId)}`;
  return action ? `${base}/${action}` : base;
}

export function findTotal(totals: readonly AcpTotal[], type: string): number | null {
  return totals.find((total) => total.type === type)?.amount ?? null;
}

/** Short customer-facing label for a promotion agent decision, or null for none. */
export function promotionLabel(promotion: AcpPromotion | null | undefined): string | null {
  if (!promotion || promotion.action === "NO_PROMO") return null;
  const percent = /^DISCOUNT_(\d{1,2})_PCT$/.exec(promotion.action);
  if (percent) return `${percent[1]}% off`;
  return promotion.action.toLowerCase().replace(/_/g, " ");
}
