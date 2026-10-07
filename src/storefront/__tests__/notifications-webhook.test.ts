// @vitest-environment node
import { createHmac } from "node:crypto";

import {
  WEBHOOK_TOLERANCE_MS,
  createReplayGuard,
  parseWebhookEvent,
  signWebhook,
  toNotificationBlock,
  verifyWebhookSignature,
} from "@/lib/notifications/webhook";

vi.mock("server-only", () => ({}));

const SECRET = "whsec_test_secret";
const NOW = Date.parse("2026-10-07T12:00:00Z");
// Same format as Python's `datetime.now(UTC).isoformat()`.
const TIMESTAMP = "2026-10-07T12:00:00.123456+00:00";

const SHIPPING_EVENT = {
  type: "shipping_update",
  data: {
    type: "shipping_update",
    checkout_session_id: "checkout_abc",
    order_id: "order_abc123",
    status: "order_confirmed",
    language: "en",
    subject: "  Your Matter order is confirmed ",
    message: "Thanks John, we're packing your order.",
    tracking_url: "http://localhost:3002/orders/order_abc123",
  },
};

const ORDER_CREATED_EVENT = {
  type: "order_created",
  data: {
    type: "order",
    order_id: "order_abc123",
    checkout_session_id: "checkout_abc",
    permalink_url: "http://localhost:8000/orders/order_abc123",
    status: "created",
    refunds: [],
  },
};

// Python's json.dumps uses ", " and ": " separators; the signature covers the raw bytes.
const BODY = '{"type": "shipping_update", "data": {"order_id": "order_abc123"}}';

function verify(overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    secret: SECRET,
    body: BODY,
    timestamp: TIMESTAMP,
    signature: signWebhook(SECRET, TIMESTAMP, BODY),
    now: NOW,
    ...overrides,
  });
}

describe("verifyWebhookSignature", () => {
  it("matches the merchant's HMAC-SHA256 hex over `{timestamp}.{body}`", () => {
    const expected = createHmac("sha256", SECRET).update(`${TIMESTAMP}.${BODY}`).digest("hex");
    expect(signWebhook(SECRET, TIMESTAMP, BODY)).toBe(expected);
    expect(verify()).toEqual({ ok: true, signature: expected });
    expect(verify({ signature: expected.toUpperCase() })).toEqual({
      ok: true,
      signature: expected,
    });
  });

  it("accepts Z and +0000 offsets within the tolerance window", () => {
    for (const timestamp of ["2026-10-07T12:04:59Z", "2026-10-07T11:55:01+0000"]) {
      expect(verify({ timestamp, signature: signWebhook(SECRET, timestamp, BODY) }).ok).toBe(true);
    }
  });

  it("rejects missing headers", () => {
    expect(verify({ signature: null })).toEqual({ ok: false, reason: "missing_signature" });
    expect(verify({ timestamp: null })).toEqual({ ok: false, reason: "missing_signature" });
    expect(verify({ signature: "" })).toEqual({ ok: false, reason: "missing_signature" });
  });

  it("rejects a bad signature, a tampered body and the wrong secret", () => {
    expect(verify({ signature: "bad" })).toEqual({ ok: false, reason: "invalid_signature" });
    expect(verify({ signature: "0".repeat(64) })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
    expect(verify({ signature: `sha256=${signWebhook(SECRET, TIMESTAMP, BODY)}` })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
    expect(verify({ body: `${BODY} ` })).toEqual({ ok: false, reason: "invalid_signature" });
    expect(verify({ secret: "whsec_other" })).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects stale or future timestamps outside five minutes, before checking the HMAC", () => {
    const stale = new Date(NOW - WEBHOOK_TOLERANCE_MS - 1000).toISOString();
    const future = new Date(NOW + WEBHOOK_TOLERANCE_MS + 1000).toISOString();
    for (const timestamp of [stale, future]) {
      expect(verify({ timestamp, signature: signWebhook(SECRET, timestamp, BODY) })).toEqual({
        ok: false,
        reason: "stale_timestamp",
      });
    }
  });

  it("rejects timestamps without a time or offset", () => {
    for (const timestamp of ["2026-10-07", "2026-10-07T12:00:00", "1791374400", "garbage"]) {
      expect(verify({ timestamp, signature: signWebhook(SECRET, timestamp, BODY) })).toEqual({
        ok: false,
        reason: "invalid_timestamp",
      });
    }
  });
});

describe("createReplayGuard", () => {
  it("remembers signatures until they expire and stays bounded", () => {
    const guard = createReplayGuard(2, 1000);
    guard.add("a", 0);
    expect(guard.has("a", 500)).toBe(true);
    expect(guard.has("a", 1000)).toBe(false);

    guard.add("b", 100);
    guard.add("c", 100);
    guard.add("d", 100);
    expect(guard.has("b", 200)).toBe(false);
    expect(guard.has("c", 200)).toBe(true);
    expect(guard.has("d", 200)).toBe(true);
  });
});

describe("parseWebhookEvent / toNotificationBlock", () => {
  it("maps shipping_update to a notification block", () => {
    const parsed = parseWebhookEvent(SHIPPING_EVENT);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(toNotificationBlock(parsed.event, "2026-10-07T12:00:01.000Z")).toEqual({
      type: "notification",
      subject: "Your Matter order is confirmed",
      message: "Thanks John, we're packing your order.",
      status: "order_confirmed",
      orderId: "order_abc123",
      trackingUrl: "http://localhost:3002/orders/order_abc123",
      receivedAt: "2026-10-07T12:00:01.000Z",
    });
  });

  it("allows a missing tracking_url and drops non-http links", () => {
    const withoutUrl: Record<string, unknown> = { ...SHIPPING_EVENT.data };
    delete withoutUrl.tracking_url;
    const parsed = parseWebhookEvent({ ...SHIPPING_EVENT, data: withoutUrl });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(toNotificationBlock(parsed.event, "t")?.trackingUrl).toBeNull();

    const unsafe = parseWebhookEvent({
      ...SHIPPING_EVENT,
      data: { ...SHIPPING_EVENT.data, tracking_url: "javascript:alert(1)" },
    });
    if (!unsafe.ok) throw new Error(unsafe.error);
    expect(toNotificationBlock(unsafe.event, "t")?.trackingUrl).toBeNull();
  });

  it("acknowledges order events without surfacing them", () => {
    const parsed = parseWebhookEvent(ORDER_CREATED_EVENT);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.event.type).toBe("order_created");
    expect(toNotificationBlock(parsed.event, "t")).toBeNull();
  });

  it.each([
    ["unknown type", { ...SHIPPING_EVENT, type: "refund_issued" }],
    ["missing data", { type: "shipping_update" }],
    ["extra top-level field", { ...SHIPPING_EVENT, extra: true }],
    ["extra data field", { ...SHIPPING_EVENT, data: { ...SHIPPING_EVENT.data, html: "<b>" } }],
    ["bad order id", { ...SHIPPING_EVENT, data: { ...SHIPPING_EVENT.data, order_id: "../x" } }],
    ["bad status", { ...SHIPPING_EVENT, data: { ...SHIPPING_EVENT.data, status: "lost" } }],
    ["blank message", { ...SHIPPING_EVENT, data: { ...SHIPPING_EVENT.data, message: "  " } }],
    ["array body", [SHIPPING_EVENT]],
  ])("rejects %s", (_label, payload) => {
    expect(parseWebhookEvent(payload).ok).toBe(false);
  });
});
