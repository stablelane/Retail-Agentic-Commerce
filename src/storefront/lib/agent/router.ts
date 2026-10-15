import "server-only";

import { CATEGORIES, type CategoryId } from "@/lib/commerce/catalog";
import type { ChatIntent } from "@/lib/agent/intents";
import type { ToolName } from "@/lib/agent/tools";
import type { ChatCartLine } from "@/lib/agent/types";

/** A deterministic tool call plus the one-line reply that accompanies it. */
export interface RoutedTurn {
  name: ToolName;
  args: Record<string, unknown>;
  text: string;
}

export interface RouterContext {
  productId?: string | undefined;
  cartItems: readonly ChatCartLine[];
}

const ORDER_REF = /\border_[A-Za-z0-9_-]{1,64}/;
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}/;

const CATEGORY_WORDS: Record<CategoryId, RegExp> = {
  "live-entertainment": /\b(concerts?|shows?|comedy|theatre|theater|live)\b/,
  family: /\b(family|kids?|children|with kids)\b/,
  sports: /\b(sports?|basketball|football|match|game)\b/,
  attractions: /\b(attractions?|theme parks?|parks?)\b/,
  tours: /\b(tours?|sightseeing|cruise)\b/,
};

export function extractOrderReference(text: string): { orderId?: string; email?: string } {
  const orderId = ORDER_REF.exec(text)?.[0];
  const email = EMAIL.exec(text)?.[0];
  return { ...(orderId ? { orderId } : {}), ...(email ? { email } : {}) };
}

export function detectCategory(text: string): CategoryId | null {
  const lower = text.toLowerCase();
  for (const { id } of CATEGORIES) {
    if (CATEGORY_WORDS[id].test(lower)) return id;
  }
  return null;
}

function trackOrder(text: string, fallbackText: string): RoutedTurn {
  const { orderId, email } = extractOrderReference(text);
  return {
    name: "track_order",
    args: { ...(orderId ? { order_id: orderId } : {}), ...(email ? { email } : {}) },
    text: orderId ? "Here's the latest on your order." : fallbackText,
  };
}

/** Run a suggestion chip / inline form deterministically (§5.6). */
export function routeIntent(intent: ChatIntent, message: string): RoutedTurn {
  if (intent.tool === "track_order") return trackOrder(message, intent.text);
  return { name: intent.tool, args: { ...intent.args }, text: intent.text };
}

/** Keyword router used when the LLM is unavailable (§5.6). */
export function routeMessage(message: string, context: RouterContext): RoutedTurn {
  const text = message.toLowerCase();

  if (/\b(orders?|track(ing)?|where is|where's|shipped|delivery)\b/.test(text)) {
    return trackOrder(message, "Enter your order number and email and I'll look it up.");
  }
  if (/\b(sale|discounted|deals?)\b/.test(text)) {
    return {
      name: "list_catalog",
      args: { on_sale_only: true, limit: 8, title: "On sale now" },
      text: "Here's what's on sale right now.",
    };
  }
  if (/\b(bag|cart|basket)\b/.test(text)) {
    return { name: "get_cart", args: {}, text: "Here's what's in your bag." };
  }
  if (
    /\b(mandate|reserve ?pay|set ?up upi)\b/.test(text) ||
    (/\bupi\b/.test(text) && !/\b(pay|buy)\b/.test(text))
  ) {
    return { name: "setup_upi_mandate", args: {}, text: "Setting up UPI ReservePay." };
  }
  if (/\b(pay|buy)\b/.test(text)) {
    return { name: "pay_with_upi", args: {}, text: "Paying from your UPI mandate." };
  }
  if (/\b(checkout|check out)\b/.test(text)) {
    return { name: "start_checkout", args: {}, text: "You're ready to check out." };
  }
  if (/\b(points|account|loyalty|rewards?)\b/.test(text)) {
    return { name: "get_account", args: {}, text: "Here's your account summary." };
  }
  if (/\b(recommend\w*|goes with|go with|pair\w*|match\w*)\b/.test(text)) {
    const productId = context.productId ?? context.cartItems[0]?.id;
    if (productId) {
      return {
        name: "get_recommendations",
        args: { product_id: productId, title: "Pairs well with your pick" },
        text: "These would pair nicely.",
      };
    }
    return {
      name: "list_catalog",
      args: { limit: 8, title: "Popular picks" },
      text: "Here are a few popular picks to start with.",
    };
  }

  const category = detectCategory(text);
  const label = CATEGORIES.find((entry) => entry.id === category)?.label;
  return {
    name: "search_products",
    args: {
      query: message.trim().slice(0, 200),
      limit: 6,
      title: label ?? "Here's what I found",
      ...(category ? { category } : {}),
    },
    text: "Here's what I found.",
  };
}
