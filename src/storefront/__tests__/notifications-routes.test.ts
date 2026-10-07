// @vitest-environment node
import { NextRequest } from "next/server";

import { GET } from "@/app/api/notifications/stream/route";
import { POST } from "@/app/api/webhooks/acp/route";
import type { NotificationBlock } from "@/lib/agent/types";
import { getNotificationEmitter } from "@/lib/notifications/emitter";
import type { NotificationEvent } from "@/lib/notifications/types";
import { signWebhook } from "@/lib/notifications/webhook";

vi.mock("server-only", () => ({}));

const SECRET = "whsec_route_test";
const WEBHOOK_URL = "http://localhost:3002/api/webhooks/acp";
const STREAM_URL = "http://localhost:3002/api/notifications/stream";

let counter = 0;

function shippingBody(overrides: Record<string, unknown> = {}): string {
  counter += 1;
  return JSON.stringify({
    type: "shipping_update",
    data: {
      type: "shipping_update",
      checkout_session_id: "checkout_route",
      order_id: `order_route${counter}`,
      status: "order_shipped",
      language: "en",
      subject: "On its way",
      message: "Your order shipped.",
      tracking_url: `http://localhost:3002/orders/order_route${counter}`,
      ...overrides,
    },
  });
}

function webhook(
  body: string,
  {
    timestamp = new Date().toISOString(),
    signature,
    headers = {},
  }: { timestamp?: string; signature?: string | null; headers?: Record<string, string> } = {}
): NextRequest {
  const signed = signature === undefined ? signWebhook(SECRET, timestamp, body) : signature;
  return new NextRequest(WEBHOOK_URL, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": timestamp,
      ...(signed === null ? {} : { "x-webhook-signature": signed }),
      ...headers,
    },
  });
}

function capture(): { events: NotificationEvent[]; stop: () => void } {
  const events: NotificationEvent[] = [];
  const stop = getNotificationEmitter().subscribe((event) => events.push(event));
  if (!stop) throw new Error("subscriber cap reached");
  return { events, stop };
}

beforeEach(() => {
  vi.stubEnv("WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/acp", () => {
  it("verifies a signed shipping_update and publishes a notification", async () => {
    const { events, stop } = capture();
    const body = shippingBody();
    const response = await POST(webhook(body));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ received: true, type: "shipping_update" });
    expect(events).toHaveLength(1);
    expect(json.event_id).toBe(events[0]?.id);
    expect(events[0]?.block).toMatchObject({
      type: "notification",
      subject: "On its way",
      message: "Your order shipped.",
      status: "order_shipped",
      orderId: `order_route${counter}`,
      trackingUrl: `http://localhost:3002/orders/order_route${counter}`,
    } satisfies Partial<NotificationBlock>);
    stop();
  });

  it("ignores a replayed delivery", async () => {
    const { events, stop } = capture();
    const body = shippingBody();
    const timestamp = new Date().toISOString();
    expect((await POST(webhook(body, { timestamp }))).status).toBe(200);
    const replay = await POST(webhook(body, { timestamp }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect(events).toHaveLength(1);
    stop();
  });

  it("acknowledges order events without publishing", async () => {
    const { events, stop } = capture();
    const body = JSON.stringify({
      type: "order_created",
      data: {
        type: "order",
        order_id: "order_created1",
        checkout_session_id: "checkout_route",
        permalink_url: "http://localhost:8000/orders/order_created1",
        status: "created",
        refunds: [],
      },
    });
    const response = await POST(webhook(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, type: "order_created" });
    expect(events).toHaveLength(0);
    stop();
  });

  it.each([
    ["a missing signature", { signature: null }, "missing_signature"],
    ["a bad signature", { signature: "bad" }, "invalid_signature"],
    [
      "a stale timestamp",
      { timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString() },
      "stale_timestamp",
    ],
  ])("rejects %s with 401", async (_label, options, code) => {
    const { events, stop } = capture();
    const response = await POST(webhook(shippingBody(), options));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code, message: "Invalid webhook signature" },
    });
    expect(events).toHaveLength(0);
    stop();
  });

  it("rejects signed bodies that are not JSON or not a known event with 400", async () => {
    const badJson = await POST(webhook("{not json"));
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toMatchObject({ error: { code: "invalid_json" } });

    const badPayload = await POST(webhook(shippingBody({ order_id: "nope" })));
    expect(badPayload.status).toBe(400);
    expect(await badPayload.json()).toMatchObject({ error: { code: "invalid_payload" } });
  });

  it("rejects oversized bodies with 413", async () => {
    const body = shippingBody({ message: "x".repeat(70 * 1024) });
    expect((await POST(webhook(body))).status).toBe(413);
    const lying = webhook(body, { headers: { "content-length": "10" } });
    expect((await POST(lying)).status).toBe(413);
  });

  it("refuses every delivery when WEBHOOK_SECRET is unset, without logging secrets", async () => {
    vi.stubEnv("WEBHOOK_SECRET", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(webhook(shippingBody()));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "misconfigured" } });
    expect(log.mock.calls.flat().join(" ")).not.toContain(SECRET);
  });
});

const decoder = new TextDecoder();

function bodyReader(response: Response): ReadableStreamDefaultReader<Uint8Array> {
  if (!response.body) throw new Error("no body");
  return response.body.getReader();
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string
): Promise<string> {
  let text = "";
  while (!text.includes(needle)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("GET /api/notifications/stream", () => {
  it("streams published notifications and unsubscribes on abort", async () => {
    const emitter = getNotificationEmitter();
    const before = emitter.subscriberCount();
    const abort = new AbortController();
    const response = GET(new NextRequest(STREAM_URL, { signal: abort.signal }));

    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(emitter.subscriberCount()).toBe(before + 1);

    const reader = bodyReader(response);
    const intro = await readUntil(reader, "event: ready");
    expect(intro).toContain("retry: 5000");
    expect(intro).toContain(`id: ${emitter.cursor()}\nevent: ready\ndata: {}`);
    expect(intro).not.toContain("event: notification");

    expect((await POST(webhook(shippingBody()))).status).toBe(200);
    const frame = await readUntil(reader, "\n\n");
    expect(frame).toMatch(/^id: [a-z0-9]+-\d+\nevent: notification\ndata: \{/);
    const data = JSON.parse(frame.split("data: ")[1] ?? "") as NotificationBlock;
    expect(data).toMatchObject({ type: "notification", message: "Your order shipped." });

    abort.abort();
    expect(emitter.subscriberCount()).toBe(before);
    expect((await reader.read()).done).toBe(true);
  });

  it("replays events newer than Last-Event-ID", async () => {
    const emitter = getNotificationEmitter();
    const cursor = emitter.cursor();
    await POST(webhook(shippingBody({ message: "First." })));
    await POST(webhook(shippingBody({ message: "Second." })));

    const abort = new AbortController();
    const response = GET(
      new NextRequest(STREAM_URL, { signal: abort.signal, headers: { "last-event-id": cursor } })
    );
    const text = await readUntil(bodyReader(response), "event: ready");
    expect(text.indexOf("First.")).toBeGreaterThan(-1);
    expect(text.indexOf("Second.")).toBeGreaterThan(text.indexOf("First."));
    expect(text.indexOf("event: ready")).toBeGreaterThan(text.indexOf("Second."));
    abort.abort();

    const second = new AbortController();
    const viaQuery = GET(
      new NextRequest(`${STREAM_URL}?lastEventId=${encodeURIComponent(emitter.cursor())}`, {
        signal: second.signal,
      })
    );
    const empty = await readUntil(bodyReader(viaQuery), "event: ready");
    expect(empty).not.toContain("event: notification");
    second.abort();
  });
});
