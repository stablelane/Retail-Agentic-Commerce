import "server-only";

import type { CheckoutSession } from "@/lib/commerce/acp";
import { getApiVersion, getMerchantConfig } from "@/lib/env";

const REQUEST_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Merchant API response types (prices are integer cents)
// ---------------------------------------------------------------------------

export interface Product {
  id: string;
  sku: string;
  name: string;
  base_price: number;
  compare_at_price: number | null;
  stock_count: number;
  min_margin: number;
  image_url: string;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  attributes: string[];
  venue?: string | null;
  sessions?: EventSessionSummary[];
}

export interface EventSessionSummary {
  id: string;
  starts_at: string;
  seats_left: number;
}

export interface ProductListResponse {
  products: Product[];
  total: number;
  category: string | null;
}

export interface ListProductsParams {
  category?: string;
  date?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export type ShippingStatus =
  "order_confirmed" | "tickets_issued" | "order_shipped" | "out_for_delivery" | "delivered";

export interface OrderStatusEvent {
  status: ShippingStatus;
  at: string;
}

export interface Buyer {
  first_name: string;
  last_name: string | null;
  email: string;
  phone_number: string | null;
}

export interface Address {
  name: string;
  line_one: string;
  line_two: string | null;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  phone_number: string | null;
}

export interface LineItem {
  id: string;
  item: { id: string; quantity: number };
  name: string | null;
  base_amount: number;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface Total {
  type: string;
  display_text: string;
  amount: number;
}

export interface FulfillmentSummary {
  option_id: string;
  title: string;
  carrier_info: string | null;
  earliest_delivery_time: string | null;
  latest_delivery_time: string | null;
}

export interface OrderStatusResponse {
  id: string;
  checkout_session_id: string;
  permalink_url: string;
  status: ShippingStatus;
  status_history: OrderStatusEvent[];
  placed_at: string;
  buyer: Buyer;
  line_items: LineItem[];
  totals: Total[];
  fulfillment_address: Address | null;
  fulfillment: FulfillmentSummary | null;
  tracking_url: string;
  estimated_delivery: string | null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class MerchantApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "MerchantApiError";
  }
}

/** GET a merchant path; resolves to null on 404. */
async function merchantGet<T>(path: string, query?: URLSearchParams): Promise<T | null> {
  const { baseUrl, apiKey } = getMerchantConfig();
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + path;
  if (query) url.search = query.toString();

  const headers: Record<string, string> = {
    Accept: "application/json",
    "API-Version": getApiVersion(),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MerchantApiError("Merchant API is unreachable", 502);
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MerchantApiError(`Merchant API responded with ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

export async function listProducts(params: ListProductsParams = {}): Promise<ProductListResponse> {
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.date) query.set("date", params.date);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  query.set("limit", String(params.limit ?? 100));
  if (params.offset) query.set("offset", String(params.offset));

  const result = await merchantGet<ProductListResponse>("/products", query);
  if (!result) throw new MerchantApiError("Product listing not found", 404);
  return result;
}

export async function getProduct(productId: string): Promise<Product | null> {
  return merchantGet<Product>(`/products/${encodeURIComponent(productId)}`);
}

export async function getCheckoutSession(sessionId: string): Promise<CheckoutSession | null> {
  return merchantGet<CheckoutSession>(`/checkout_sessions/${encodeURIComponent(sessionId)}`);
}

/** Resolves to null when the order does not exist or the email does not match. */
export async function getOrder(
  orderId: string,
  email: string
): Promise<OrderStatusResponse | null> {
  return merchantGet<OrderStatusResponse>(
    `/orders/${encodeURIComponent(orderId)}`,
    new URLSearchParams({ email })
  );
}
