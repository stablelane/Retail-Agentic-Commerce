import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { NotificationBlock } from "@/lib/agent/types";
import { safeHttpUrl } from "@/lib/commerce/orders";
import { ORDER_ID } from "@/lib/commerce/proxy-allowlist";

/** ACP webhook verification and payload mapping (feature 18, §4.6). */

export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
// The merchant sends `datetime.now(UTC).isoformat()`; an explicit offset is required.
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

/** Hex HMAC-SHA256 of `{timestamp}.{body}`, as `generate_webhook_signature` computes it. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export type SignatureFailure =
  "missing_signature" | "invalid_timestamp" | "stale_timestamp" | "invalid_signature";

export type SignatureResult =
  { ok: true; signature: string } | { ok: false; reason: SignatureFailure };

export interface SignatureInput {
  secret: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  now?: number;
}

export function verifyWebhookSignature({
  secret,
  body,
  timestamp,
  signature,
  now = Date.now(),
}: SignatureInput): SignatureResult {
  if (!signature || !timestamp) return { ok: false, reason: "missing_signature" };
  const issuedAt = TIMESTAMP_PATTERN.test(timestamp) ? Date.parse(timestamp) : Number.NaN;
  if (Number.isNaN(issuedAt)) return { ok: false, reason: "invalid_timestamp" };
  if (Math.abs(now - issuedAt) > WEBHOOK_TOLERANCE_MS) {
    return { ok: false, reason: "stale_timestamp" };
  }
  if (!SIGNATURE_PATTERN.test(signature)) return { ok: false, reason: "invalid_signature" };
  const expected = Buffer.from(signWebhook(secret, timestamp, body), "hex");
  const provided = Buffer.from(signature, "hex");
  return timingSafeEqual(expected, provided)
    ? { ok: true, signature: signature.toLowerCase() }
    : { ok: false, reason: "invalid_signature" };
}

/**
 * Remembers accepted signatures for longer than the timestamp window, so a captured delivery
 * cannot be replayed. Bounded: the oldest entries are evicted first.
 */
export function createReplayGuard(maxEntries = 500, ttlMs = WEBHOOK_TOLERANCE_MS * 2) {
  const seen = new Map<string, number>();
  return {
    has(signature: string, now = Date.now()): boolean {
      return (seen.get(signature) ?? 0) > now;
    },
    add(signature: string, now = Date.now()): void {
      // Insertion order equals expiry order because the TTL is constant.
      for (const [key, expiry] of seen) {
        if (expiry > now && seen.size < maxEntries) break;
        seen.delete(key);
      }
      seen.delete(signature);
      seen.set(signature, now + ttlMs);
    },
  };
}

// Payload shapes mirror `src/merchant/protocols/acp/services/webhook_delivery.py`.
const checkoutSessionId = z.string().min(1).max(128);
const orderId = z.string().regex(ORDER_ID);

const shippingUpdateEvent = z
  .object({
    type: z.literal("shipping_update"),
    data: z
      .object({
        type: z.literal("shipping_update"),
        checkout_session_id: checkoutSessionId,
        order_id: orderId,
        status: z.enum([
          "order_confirmed",
          "tickets_issued",
          "order_shipped",
          "out_for_delivery",
          "delivered",
        ]),
        language: z.enum(["en", "es", "fr"]),
        subject: z.string().trim().max(200),
        message: z.string().trim().min(1).max(4000),
        tracking_url: z.string().max(2048).optional(),
      })
      .strict(),
  })
  .strict();

const orderEvent = z
  .object({
    type: z.enum(["order_created", "order_updated"]),
    data: z
      .object({
        type: z.literal("order"),
        checkout_session_id: checkoutSessionId,
        order_id: orderId,
        permalink_url: z.string().max(2048),
        status: z.enum([
          "created",
          "manual_review",
          "confirmed",
          "canceled",
          "shipped",
          "fulfilled",
        ]),
        refunds: z
          .array(
            z
              .object({
                type: z.enum(["store_credit", "original_payment"]),
                amount: z.number().int().nonnegative(),
              })
              .strict()
          )
          .max(50),
      })
      .strict(),
  })
  .strict();

const webhookEventSchema = z.discriminatedUnion("type", [shippingUpdateEvent, orderEvent]);

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export function parseWebhookEvent(
  value: unknown
): { ok: true; event: WebhookEvent } | { ok: false; error: string } {
  const result = webhookEventSchema.safeParse(value);
  if (result.success) return { ok: true, event: result.data };
  const issue = result.error.issues[0];
  return {
    ok: false,
    error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid payload",
  };
}

/** Only `shipping_update` is surfaced to the shopper (§2.11); order events are acknowledged. */
export function toNotificationBlock(
  event: WebhookEvent,
  receivedAt: string
): NotificationBlock | null {
  if (event.type !== "shipping_update") return null;
  const { data } = event;
  return {
    type: "notification",
    subject: data.subject,
    message: data.message,
    status: data.status,
    orderId: data.order_id,
    trackingUrl: safeHttpUrl(data.tracking_url),
    receivedAt,
  };
}
