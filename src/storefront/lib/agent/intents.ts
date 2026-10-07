/**
 * Suggestion chips (§2.11) and their deterministic tool mapping (§5.6). Browser-safe:
 * the overlay renders `CHAT_INTENTS` and tags chip messages with the intent id.
 */

import type { ToolName } from "@/lib/agent/tools";
import { CHAT_INTENT_IDS, type ChatIntentId } from "@/lib/agent/types";

export type ChatIntentIcon = "sparkles" | "truck" | "search" | "list";

export interface ChatIntent {
  id: ChatIntentId;
  label: string;
  /** lucide-react icon name. */
  icon: ChatIntentIcon;
  tool: ToolName;
  args: Record<string, unknown>;
  /** Canned reply used when the intent runs without the LLM. */
  text: string;
  /** With an LLM configured the chip goes through the model (it may ask a clarifying question). */
  preferLlm: boolean;
}

export const CHAT_INTENTS: readonly ChatIntent[] = [
  {
    id: "help_me_choose",
    label: "Help me choose",
    icon: "sparkles",
    tool: "list_catalog",
    args: { limit: 8, title: "A few favourites" },
    text: "Here are a few favourites — tell me who you're shopping for or what you need and I'll narrow it down.",
    preferLlm: true,
  },
  {
    id: "track_order",
    label: "Track my order",
    icon: "truck",
    tool: "track_order",
    args: {},
    text: "Enter your order number and email and I'll look it up.",
    preferLlm: false,
  },
  {
    id: "weekend_trip",
    label: "Suggest essentials for a weekend trip",
    icon: "search",
    tool: "search_products",
    args: { query: "weekend trip essentials", limit: 6, title: "Weekend trip essentials" },
    text: "Here are some easy pieces to pack for a weekend away.",
    preferLlm: false,
  },
  {
    id: "gift_runner",
    label: "Recommend a gift for a runner",
    icon: "search",
    tool: "search_products",
    args: { query: "running", limit: 6, title: "Gifts for runners" },
    text: "A few ideas any runner would appreciate.",
    preferLlm: false,
  },
  {
    id: "pairs_with_classic_tee",
    label: "What goes with the Classic Tee?",
    icon: "list",
    tool: "get_recommendations",
    args: { product_id: "prod_1", title: "Pairs well with the Classic Tee" },
    text: "These pair nicely with the Classic Tee.",
    preferLlm: false,
  },
];

export function isChatIntentId(value: unknown): value is ChatIntentId {
  return typeof value === "string" && (CHAT_INTENT_IDS as readonly string[]).includes(value);
}

export function getChatIntent(id: ChatIntentId): ChatIntent {
  const intent = CHAT_INTENTS.find((candidate) => candidate.id === id);
  if (!intent) throw new Error(`Unknown chat intent: ${id}`);
  return intent;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[\s?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A typed message that exactly matches a chip label is treated as that chip. */
export function intentFromText(text: string): ChatIntent | null {
  const normalized = normalize(text);
  return CHAT_INTENTS.find((intent) => normalize(intent.label) === normalized) ?? null;
}

const BROWSE_FOLLOW_UPS = ["What's on sale?", "Show me outerwear", "View my bag"];
const BAG_FOLLOW_UPS = ["Go to checkout", "What's on sale?", "Track my order"];

/** Follow-up chips (≤ 4) keyed by the last tool that ran. */
export const FOLLOW_UP_SUGGESTIONS: Record<ToolName, readonly string[]> = {
  search_products: BROWSE_FOLLOW_UPS,
  list_catalog: BROWSE_FOLLOW_UPS,
  get_recommendations: BROWSE_FOLLOW_UPS,
  get_product_details: ["What goes with this?", "View my bag", "What's on sale?"],
  add_to_cart: BAG_FOLLOW_UPS,
  update_cart: BAG_FOLLOW_UPS,
  get_cart: BAG_FOLLOW_UPS,
  start_checkout: ["View my bag", "Track my order"],
  track_order: ["View my bag", "Help me choose"],
  get_account: ["Track my order", "Help me choose"],
};
