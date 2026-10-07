/**
 * Chat agent wire contract (feature 18, §5): request body, SSE events and UI blocks.
 * Browser-safe; shared by `/api/chat` and the chat overlay.
 */

export const CHAT_PAGES = [
  "home",
  "shop",
  "pdp",
  "bag",
  "checkout",
  "orders",
  "account",
  "contact",
] as const;
export type ChatPage = (typeof CHAT_PAGES)[number];

export const CHAT_LOCALES = ["en", "es", "fr"] as const;
export type ChatLocale = (typeof CHAT_LOCALES)[number];

export const CHAT_INTENT_IDS = [
  "help_me_choose",
  "track_order",
  "weekend_trip",
  "gift_runner",
  "pairs_with_classic_tee",
] as const;
export type ChatIntentId = (typeof CHAT_INTENT_IDS)[number];

export const CHAT_LIMITS = {
  maxMessages: 20,
  maxMessageLength: 2000,
  maxCartItems: 50,
  maxBodyBytes: 64 * 1024,
} as const;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatCartLine {
  id: string;
  quantity: number;
}

export interface ChatContext {
  page: ChatPage;
  productId?: string;
  orderId?: string;
}

/** `POST /api/chat` body. The last message must be from the user. */
export interface ChatRequest {
  messages: ChatMessage[];
  cart: { sessionId: string | null; items: ChatCartLine[] };
  context: ChatContext;
  locale?: ChatLocale;
  /** Set when the message came from a suggestion chip or an inline form (§5.6). */
  intent?: ChatIntentId;
}

// ---------------------------------------------------------------------------
// UI blocks (§5.4). Prices are integer cents.
// ---------------------------------------------------------------------------

export interface ProductTileData {
  id: string;
  name: string;
  price: number;
  compareAtPrice?: number | null;
  imageUrl: string;
  category?: string;
  stockCount?: number;
  reasoning?: string;
}

export interface ProductCarouselBlock {
  type: "product_carousel";
  title: string;
  subtitle?: string;
  variant?: "carousel" | "detail";
  recommendationRequestId?: string;
  products: ProductTileData[];
}

export interface CartSummaryItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
}

export interface CartTotal {
  type: string;
  display_text: string;
  amount: number;
}

export interface CartSummaryBlock {
  type: "cart_summary";
  items: CartSummaryItem[];
  totals: CartTotal[] | null;
  sessionId: string | null;
}

export interface CheckoutPanelBlock {
  type: "checkout_panel";
  sessionId: string | null;
  total: number | null;
  itemCount: number;
}

export interface OrderFormBlock {
  type: "order_form";
  prefill: { orderId?: string; email: string };
  reason?: "missing_id" | "not_found";
}

export type OrderShippingStatus =
  "order_confirmed" | "order_shipped" | "out_for_delivery" | "delivered";

export interface OrderStatusBlock {
  type: "order_status";
  orderId: string;
  status: OrderShippingStatus;
  statusHistory: Array<{ status: string; at: string }>;
  estimatedDelivery: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  items: Array<{ name: string; quantity: number }>;
  total: number;
}

export interface AccountSummaryBlock {
  type: "account_summary";
  name: string;
  email: string;
  tier: string;
  loyaltyPoints: number;
  memberSince: string;
}

export interface NotificationBlock {
  type: "notification";
  subject: string;
  message: string;
  status: string;
  orderId: string;
  trackingUrl: string | null;
  receivedAt: string;
}

export type UIBlock =
  | ProductCarouselBlock
  | CartSummaryBlock
  | CheckoutPanelBlock
  | OrderFormBlock
  | OrderStatusBlock
  | AccountSummaryBlock
  | NotificationBlock;

export type UIBlockType = UIBlock["type"];

// ---------------------------------------------------------------------------
// SSE events (§5.1). Each frame is `event: <name>\ndata: <json>\n\n`; `done` is always last.
// ---------------------------------------------------------------------------

/** Same shape as the browser cart store's `CartItem`, so it can be applied directly. */
export interface CartUpdateItem {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  quantity: number;
  maxQuantity: number;
}

export interface ChatEventMap {
  text: { delta: string };
  tool_status: { tool: string; label: string };
  block: UIBlock;
  cart_update: { items: CartUpdateItem[]; sessionId: string | null };
  suggestions: { chips: string[] };
  error: { code: ChatErrorCode; message: string };
  done: { steps: number; fallback: boolean };
}

export type ChatEventName = keyof ChatEventMap;

export type ChatEvent = {
  [K in ChatEventName]: { event: K; data: ChatEventMap[K] };
}[ChatEventName];

export type ChatErrorCode =
  | "bad_request"
  | "rate_limited"
  | "llm_unavailable"
  | "merchant_unavailable"
  | "tool_failed"
  | "internal_error";

export const CHAT_EVENT_NAMES: readonly ChatEventName[] = [
  "text",
  "tool_status",
  "block",
  "cart_update",
  "suggestions",
  "error",
  "done",
];
