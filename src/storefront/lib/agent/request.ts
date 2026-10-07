import "server-only";

import { z } from "zod";

import {
  CHAT_INTENT_IDS,
  CHAT_LIMITS,
  CHAT_LOCALES,
  CHAT_PAGES,
  type ChatRequest,
} from "@/lib/agent/types";
import { CHECKOUT_SESSION_ID, ORDER_ID, PRODUCT_ID } from "@/lib/commerce/proxy-allowlist";

const chatRequestSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(CHAT_LIMITS.maxMessageLength),
          })
          .strict()
      )
      .min(1)
      .max(CHAT_LIMITS.maxMessages),
    cart: z
      .object({
        sessionId: z.string().regex(CHECKOUT_SESSION_ID).nullable(),
        items: z
          .array(
            z
              .object({
                id: z.string().regex(PRODUCT_ID),
                quantity: z.number().int().min(1).max(10),
              })
              .strict()
          )
          .max(CHAT_LIMITS.maxCartItems),
      })
      .strict(),
    context: z
      .object({
        page: z.enum(CHAT_PAGES),
        productId: z.string().regex(PRODUCT_ID).optional(),
        orderId: z.string().regex(ORDER_ID).optional(),
      })
      .strict(),
    locale: z.enum(CHAT_LOCALES).optional(),
    intent: z.enum(CHAT_INTENT_IDS).optional(),
  })
  .strict();

export type ParsedChatRequest = { ok: true; request: ChatRequest } | { ok: false; error: string };

/** Validate an untrusted `/api/chat` body; unknown fields are rejected. */
export function parseChatRequest(body: unknown): ParsedChatRequest {
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "body";
    return { ok: false, error: `Invalid ${path}` };
  }
  const { messages, cart, context, locale, intent } = parsed.data;
  if (messages[messages.length - 1]?.role !== "user") {
    return { ok: false, error: "The last message must be from the user" };
  }

  // Merge duplicate cart lines so quantities stay within the per-line cap.
  const lines = new Map<string, number>();
  for (const item of cart.items) {
    lines.set(item.id, Math.min(10, (lines.get(item.id) ?? 0) + item.quantity));
  }

  return {
    ok: true,
    request: {
      messages,
      cart: {
        sessionId: cart.sessionId,
        items: [...lines].map(([id, quantity]) => ({ id, quantity })),
      },
      context: {
        page: context.page,
        ...(context.productId ? { productId: context.productId } : {}),
        ...(context.orderId ? { orderId: context.orderId } : {}),
      },
      ...(locale ? { locale } : {}),
      ...(intent ? { intent } : {}),
    },
  };
}
