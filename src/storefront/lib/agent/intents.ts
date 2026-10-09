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
    label: "Plan my weekend",
    icon: "sparkles",
    tool: "list_catalog",
    args: { limit: 8, title: "A few favourites" },
    text: "Tell me your dates and how many people, and I'll plan the days.",
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
    label: "Family days out",
    icon: "search",
    tool: "search_products",
    args: { query: "family days out", category: "family", limit: 6, title: "Family days out" },
    text: "Here are family days out in Dubai.",
    preferLlm: false,
  },
  {
    id: "gift_runner",
    label: "Live shows",
    icon: "search",
    tool: "search_products",
    args: {
      query: "concerts, comedy and live shows",
      category: "live-entertainment",
      limit: 6,
      title: "Live shows",
    },
    text: "Here are concerts and shows.",
    preferLlm: false,
  },
  {
    id: "pairs_with_classic_tee",
    label: "Sports events",
    icon: "list",
    tool: "list_catalog",
    args: { category: "sports", limit: 6, title: "Sports events" },
    text: "Here are upcoming sports events.",
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

const BROWSE_FOLLOW_UPS = ["What's on this weekend?", "Family days out", "View my bag"];
const BAG_FOLLOW_UPS = ["Go to checkout", "What's on this weekend?", "Track my order"];

/** Follow-up chips (≤ 4) keyed by the last tool that ran. */
export const FOLLOW_UP_SUGGESTIONS: Record<ToolName, readonly string[]> = {
  search_products: BROWSE_FOLLOW_UPS,
  list_catalog: BROWSE_FOLLOW_UPS,
  get_recommendations: BROWSE_FOLLOW_UPS,
  get_product_details: ["Similar events", "View my bag", "What's on this weekend?"],
  plan_itinerary: ["Book all of these", "View my bag", "Family days out"],
  add_to_cart: BAG_FOLLOW_UPS,
  update_cart: BAG_FOLLOW_UPS,
  get_cart: BAG_FOLLOW_UPS,
  start_checkout: ["View my bag", "Track my order"],
  track_order: ["View my bag", "Help me choose"],
  get_account: ["Track my order", "Help me choose"],
};
