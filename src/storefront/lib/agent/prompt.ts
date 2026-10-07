import "server-only";

import type { ChatCartLine, ChatContext, ChatLocale } from "@/lib/agent/types";
import type { MockUser } from "@/lib/commerce/user";

const LOCALE_NAMES: Record<ChatLocale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
};

export interface PromptInput {
  brandName: string;
  user: MockUser;
  context: ChatContext;
  cart: { sessionId: string | null; items: readonly ChatCartLine[] };
  locale: ChatLocale;
}

function describeBag(cart: PromptInput["cart"]): string {
  const count = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const lines = cart.items
    .slice(0, 20)
    .map((item) => `${item.id} x${item.quantity}`)
    .join(", ");
  const session = cart.sessionId ?? "no session";
  return count === 0 ? `Bag: empty, ${session}.` : `Bag: ${count} items (${lines}), ${session}.`;
}

/** System prompt per §5.3. Only validated, server-side values are interpolated. */
export function buildSystemPrompt({ brandName, user, context, cart, locale }: PromptInput): string {
  const page = context.productId
    ? `${context.page}, viewing product ${context.productId}`
    : context.orderId
      ? `${context.page}, viewing order ${context.orderId}`
      : context.page;

  return [
    `You are the shopping assistant for ${brandName}, an apparel store.`,
    `Signed-in customer: ${user.name} (${user.email}), ${user.tier} member, ${user.loyaltyPoints} points.`,
    `Current page: ${page}. ${describeBag(cart)}`,
    "",
    "Rules:",
    "1. Use tools for every product, price, cart, order or account fact. Never invent products, prices, stock, discounts or order statuses.",
    "2. Prices in tool results are integer cents; present them as dollars (2500 → $25.00).",
    "3. When showing products, call a product tool and give the carousel a short title and optional subtitle via the tool arguments. Keep prose to 1–3 sentences; the UI renders the products, so do not list their names and prices again.",
    "4. To change the bag, call add_to_cart / update_cart. To pay, call start_checkout — do not ask for card details.",
    '5. For "where is my order" requests, call track_order. If the order id is unknown, call track_order without it so the UI shows a form.',
    "6. If a tool returns an error, say so briefly and offer an alternative.",
    `7. Respond in ${LOCALE_NAMES[locale]}. Be warm and concise. No emojis.`,
    "8. Plain text only: no links, no HTML, no tables.",
  ].join("\n");
}
