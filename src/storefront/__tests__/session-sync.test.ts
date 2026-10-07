import type { CheckoutSession, FetchLike } from "@/lib/commerce/acp";
import { createCartStore, type CartProduct } from "@/lib/commerce/cart-store";
import {
  DEFAULT_FULFILLMENT_OPTION_ID,
  createSessionSyncer,
  syncCheckoutSession,
} from "@/lib/commerce/session-sync";

const TEE: CartProduct = {
  id: "prod_1",
  name: "Classic Tee",
  price: 2500,
  imageUrl: "/prod_1.jpeg",
};
const JEANS: CartProduct = {
  id: "prod_2",
  name: "Slim Jeans",
  price: 6000,
  imageUrl: "/prod_2.jpeg",
};

const BASE = "/api/proxy/merchant";

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Items = Array<{ id: string; quantity: number }>;

function lineItems(items: Items): CheckoutSession["line_items"] {
  return items.map((item) => ({
    id: `li_${item.id}`,
    item,
    name: item.id,
    base_amount: 1000 * item.quantity,
    discount: 0,
    subtotal: 1000 * item.quantity,
    tax: 0,
    total: 1000 * item.quantity,
  }));
}

/** In-memory merchant behind the same-origin proxy; `failNext` queues one-off error replies. */
function fakeMerchant() {
  const sessions = new Map<string, CheckoutSession>();
  const calls: Call[] = [];
  const failNext: Array<{ path: RegExp; status: number; network?: boolean }> = [];
  let counter = 0;

  function newSession(items: Items): CheckoutSession {
    counter += 1;
    return {
      id: `checkout_${counter}`,
      status: "not_ready_for_payment",
      currency: "usd",
      buyer: null,
      line_items: lineItems(items),
      fulfillment_address: null,
      fulfillment_options: [
        {
          type: "shipping",
          id: "shipping_standard",
          title: "Standard",
          subtitle: "",
          subtotal: 599,
          tax: 0,
          total: 599,
        },
        {
          type: "shipping",
          id: "shipping_express",
          title: "Express",
          subtitle: "",
          subtotal: 1299,
          tax: 0,
          total: 1299,
        },
      ],
      fulfillment_option_id: null,
      totals: [],
      discounts: { codes: [], applied: [], rejected: [] },
      messages: [],
    };
  }

  const fetchImpl = vi.fn<FetchLike>(async (input, init) => {
    const path = input.slice(BASE.length);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ method, path, body });

    const failure = failNext.findIndex((entry) => entry.path.test(path));
    if (failure !== -1) {
      const [entry] = failNext.splice(failure, 1);
      if (entry?.network) throw new TypeError("Failed to fetch");
      return json(entry?.status ?? 500, { detail: { message: "nope" } });
    }

    if (method === "POST" && path === "/checkout_sessions") {
      const session = newSession((body?.items as Items | undefined) ?? []);
      const codes = (body?.discounts as { codes?: string[] } | undefined)?.codes ?? [];
      session.discounts = {
        codes,
        applied: codes.map((code) => ({
          id: `d_${code}`,
          code,
          coupon: { id: code, name: code },
          amount: 100,
        })),
        rejected: [],
      };
      sessions.set(session.id, session);
      return json(201, session);
    }

    const match = /^\/checkout_sessions\/([^/]+)(\/cancel)?$/.exec(path);
    const existing = match?.[1] ? sessions.get(match[1]) : undefined;
    if (method === "POST" && existing) {
      if (match?.[2]) {
        existing.status = "canceled";
        return json(200, existing);
      }
      if (body?.items) existing.line_items = lineItems(body.items as Items);
      if (typeof body?.fulfillment_option_id === "string") {
        existing.fulfillment_option_id = body.fulfillment_option_id;
      }
      if (body?.discounts) {
        existing.discounts = {
          codes: (body.discounts as { codes: string[] }).codes,
          applied: [],
          rejected: [],
        };
      }
      return json(200, existing);
    }
    return json(404, { detail: { message: "Not found" } });
  });

  return { sessions, calls, failNext, fetchImpl };
}

function summary(calls: readonly Call[]): string[] {
  return calls.map((call) => `${call.method} ${call.path}`);
}

describe("syncCheckoutSession", () => {
  it("creates a session with the mock buyer and auto-selects standard shipping", async () => {
    const merchant = fakeMerchant();

    const session = await syncCheckoutSession({
      items: [{ ...TEE, quantity: 2, maxQuantity: 10 }],
      sessionId: null,
      fetchImpl: merchant.fetchImpl,
    });

    expect(summary(merchant.calls)).toEqual([
      "POST /checkout_sessions",
      "POST /checkout_sessions/checkout_1",
    ]);
    expect(merchant.calls[0]?.body).toMatchObject({
      items: [{ id: "prod_1", quantity: 2 }],
      buyer: { email: "john@example.com" },
      fulfillment_address: { postal_code: "94102" },
    });
    expect(merchant.calls[1]?.body).toEqual({
      fulfillment_option_id: DEFAULT_FULFILLMENT_OPTION_ID,
    });
    expect(session?.fulfillment_option_id).toBe("shipping_standard");
  });

  it("sends ACP headers through the same-origin proxy", async () => {
    const merchant = fakeMerchant();
    await syncCheckoutSession({
      items: [{ ...TEE, quantity: 1, maxQuantity: 10 }],
      sessionId: null,
      fetchImpl: merchant.fetchImpl,
    });

    const [url, init] = merchant.fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/api/proxy/merchant/checkout_sessions");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["API-Version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(headers["Idempotency-Key"]).toMatch(/^idem_[0-9a-f]{24}$/);
    expect(headers["Request-Id"]).toMatch(/^req_[0-9a-f]{24}$/);
  });

  it("updates an existing session without re-selecting shipping", async () => {
    const merchant = fakeMerchant();
    const first = await syncCheckoutSession({
      items: [{ ...TEE, quantity: 1, maxQuantity: 10 }],
      sessionId: null,
      fetchImpl: merchant.fetchImpl,
    });
    merchant.calls.length = 0;

    const next = await syncCheckoutSession({
      items: [
        { ...TEE, quantity: 3, maxQuantity: 10 },
        { ...JEANS, quantity: 1, maxQuantity: 10 },
      ],
      sessionId: first?.id ?? null,
      previous: first,
      fetchImpl: merchant.fetchImpl,
    });

    expect(summary(merchant.calls)).toEqual(["POST /checkout_sessions/checkout_1"]);
    expect(merchant.calls[0]?.body).toEqual({
      items: [
        { id: "prod_1", quantity: 3 },
        { id: "prod_2", quantity: 1 },
      ],
    });
    expect(next?.id).toBe("checkout_1");
    expect(next?.line_items).toHaveLength(2);
  });

  it.each([404, 405])(
    "recreates a stale session (%i) and carries shipping choice and codes",
    async (status) => {
      const merchant = fakeMerchant();
      const previous = await syncCheckoutSession({
        items: [{ ...TEE, quantity: 1, maxQuantity: 10 }],
        sessionId: null,
        fetchImpl: merchant.fetchImpl,
      });
      if (!previous) throw new Error("expected a session");
      previous.fulfillment_option_id = "shipping_express";
      previous.discounts = {
        codes: ["SAVE10"],
        applied: [{ id: "d1", code: "SAVE10", coupon: { id: "c", name: "c" }, amount: 250 }],
        rejected: [],
      };
      merchant.calls.length = 0;
      merchant.failNext.push({ path: /^\/checkout_sessions\/checkout_1$/, status });

      const session = await syncCheckoutSession({
        items: [{ ...TEE, quantity: 2, maxQuantity: 10 }],
        sessionId: previous.id,
        previous,
        fetchImpl: merchant.fetchImpl,
      });

      expect(summary(merchant.calls)).toEqual([
        "POST /checkout_sessions/checkout_1",
        "POST /checkout_sessions",
        "POST /checkout_sessions/checkout_2",
      ]);
      expect(merchant.calls[1]?.body).toMatchObject({
        items: [{ id: "prod_1", quantity: 2 }],
        discounts: { codes: ["SAVE10"] },
      });
      expect(merchant.calls[2]?.body).toEqual({ fulfillment_option_id: "shipping_express" });
      expect(session?.id).toBe("checkout_2");
      expect(session?.fulfillment_option_id).toBe("shipping_express");
    }
  );

  it("recreates a session that was already completed", async () => {
    const merchant = fakeMerchant();
    const first = await syncCheckoutSession({
      items: [{ ...TEE, quantity: 1, maxQuantity: 10 }],
      sessionId: null,
      fetchImpl: merchant.fetchImpl,
    });
    const stored = merchant.sessions.get(first?.id ?? "");
    if (stored) stored.status = "completed";
    merchant.calls.length = 0;

    const session = await syncCheckoutSession({
      items: [{ ...TEE, quantity: 1, maxQuantity: 10 }],
      sessionId: "checkout_1",
      fetchImpl: merchant.fetchImpl,
    });

    expect(summary(merchant.calls)).toEqual([
      "POST /checkout_sessions/checkout_1",
      "POST /checkout_sessions",
      "POST /checkout_sessions/checkout_2",
    ]);
    expect(session?.id).toBe("checkout_2");
  });

  it("does not recreate on validation errors", async () => {
    const merchant = fakeMerchant();
    merchant.failNext.push({ path: /^\/checkout_sessions\/checkout_9$/, status: 400 });

    await expect(
      syncCheckoutSession({
        items: [{ ...TEE, quantity: 1, maxQuantity: 10 }],
        sessionId: "checkout_9",
        fetchImpl: merchant.fetchImpl,
      })
    ).rejects.toMatchObject({ name: "AcpRequestError", status: 400, message: "nope" });
    expect(summary(merchant.calls)).toEqual(["POST /checkout_sessions/checkout_9"]);
  });

  it("cancels the session when the cart is emptied", async () => {
    const merchant = fakeMerchant();
    await syncCheckoutSession({
      items: [{ ...TEE, quantity: 1, maxQuantity: 10 }],
      sessionId: null,
      fetchImpl: merchant.fetchImpl,
    });
    merchant.calls.length = 0;

    const result = await syncCheckoutSession({
      items: [],
      sessionId: "checkout_1",
      fetchImpl: merchant.fetchImpl,
    });

    expect(result).toBeNull();
    expect(summary(merchant.calls)).toEqual(["POST /checkout_sessions/checkout_1/cancel"]);
    expect(merchant.sessions.get("checkout_1")?.status).toBe("canceled");
  });

  it("makes no request for an empty cart without a session", async () => {
    const merchant = fakeMerchant();
    await expect(
      syncCheckoutSession({ items: [], sessionId: null, fetchImpl: merchant.fetchImpl })
    ).resolves.toBeNull();
    expect(merchant.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createSessionSyncer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const merchant = fakeMerchant();
    const store = createCartStore(null);
    const syncer = createSessionSyncer(store, {
      debounceMs: 300,
      retryMs: 5_000,
      fetchImpl: merchant.fetchImpl,
    });
    const settled = (sessionId: string) =>
      vi.waitFor(() =>
        expect(store.getSnapshot()).toMatchObject({ sessionId, syncStatus: "synced" })
      );
    return { merchant, store, syncer, settled };
  }

  it("creates a session for the first item after the debounce", async () => {
    const { merchant, store, syncer, settled } = setup();
    const stop = syncer.start();
    expect(merchant.fetchImpl).not.toHaveBeenCalled();

    store.add(TEE);
    await vi.advanceTimersByTimeAsync(299);
    expect(merchant.fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await settled("checkout_1");
    expect(summary(merchant.calls)).toEqual([
      "POST /checkout_sessions",
      "POST /checkout_sessions/checkout_1",
    ]);
    expect(store.getSnapshot().session?.fulfillment_option_id).toBe("shipping_standard");
    stop();
  });

  it("debounces rapid changes into one update with the final quantities", async () => {
    const { merchant, store, syncer, settled } = setup();
    const stop = syncer.start();
    store.add(TEE);
    await vi.advanceTimersByTimeAsync(300);
    await settled("checkout_1");
    merchant.calls.length = 0;

    store.setQuantity("prod_1", 2);
    await vi.advanceTimersByTimeAsync(100);
    store.add(JEANS);
    await vi.advanceTimersByTimeAsync(100);
    store.setQuantity("prod_1", 4);
    await vi.advanceTimersByTimeAsync(299);
    expect(merchant.fetchImpl).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(merchant.calls).toHaveLength(1));
    await settled("checkout_1");
    expect(summary(merchant.calls)).toEqual(["POST /checkout_sessions/checkout_1"]);
    expect(merchant.calls[0]?.body).toEqual({
      items: [
        { id: "prod_1", quantity: 4 },
        { id: "prod_2", quantity: 1 },
      ],
    });
    stop();
  });

  it("ignores store changes that do not touch items", async () => {
    const { merchant, store, syncer } = setup();
    const stop = syncer.start();
    store.setSyncStatus("offline");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(merchant.fetchImpl).not.toHaveBeenCalled();
    stop();
  });

  it("stops syncing after the stop function runs", async () => {
    const { merchant, store, syncer } = setup();
    const stop = syncer.start();
    store.add(TEE);
    stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(merchant.fetchImpl).not.toHaveBeenCalled();
  });

  it("skips the network on flush when the session already mirrors the cart", async () => {
    const { merchant, store, syncer } = setup();
    store.add(TEE);
    const session = await syncer.flush();
    expect(session?.id).toBe("checkout_1");
    merchant.fetchImpl.mockClear();

    await expect(syncer.flush()).resolves.toBe(store.getSnapshot().session);
    expect(merchant.fetchImpl).not.toHaveBeenCalled();
  });

  it("goes offline on network errors and retries", async () => {
    const { merchant, store, syncer, settled } = setup();
    merchant.failNext.push({ path: /^\/checkout_sessions$/, status: 0, network: true });
    store.add(TEE);

    await expect(syncer.flush()).rejects.toMatchObject({ status: 0 });
    expect(store.getSnapshot().syncStatus).toBe("offline");

    await vi.advanceTimersByTimeAsync(4_999);
    expect(merchant.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settled("checkout_1");
  });

  it("marks validation errors as errors without retrying", async () => {
    const { merchant, store, syncer } = setup();
    merchant.failNext.push({ path: /^\/checkout_sessions$/, status: 400 });
    store.add(TEE);

    await expect(syncer.flush()).rejects.toMatchObject({ status: 400 });
    expect(store.getSnapshot().syncStatus).toBe("error");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(merchant.calls).toHaveLength(1);
  });

  it("recreates a stale session from the stored id on start", async () => {
    const { merchant, store, syncer, settled } = setup();
    store.add(TEE);
    const session = await syncer.flush();
    if (!session) throw new Error("expected a session");
    store.setSession({ ...session, id: "checkout_gone" });
    merchant.calls.length = 0;

    const stop = syncer.start();
    await settled("checkout_2");

    expect(summary(merchant.calls)).toEqual([
      "POST /checkout_sessions/checkout_gone",
      "POST /checkout_sessions",
      "POST /checkout_sessions/checkout_2",
    ]);
    expect(merchant.calls[2]?.body).toEqual({ fulfillment_option_id: "shipping_standard" });
    stop();
  });

  it("applies a patch to a fresh session when the current one went stale", async () => {
    const { merchant, store, syncer } = setup();
    store.add(TEE);
    await syncer.flush();
    merchant.calls.length = 0;
    merchant.failNext.push({ path: /^\/checkout_sessions\/checkout_1$/, status: 404 });

    const session = await syncer.updateSession({ discounts: { codes: ["SAVE10"] } });

    expect(summary(merchant.calls)).toEqual([
      "POST /checkout_sessions/checkout_1",
      "POST /checkout_sessions",
      "POST /checkout_sessions/checkout_2",
      "POST /checkout_sessions/checkout_2",
    ]);
    expect(merchant.calls[3]?.body).toEqual({ discounts: { codes: ["SAVE10"] } });
    expect(session.id).toBe("checkout_2");
    expect(store.getSnapshot()).toMatchObject({ sessionId: "checkout_2", syncStatus: "synced" });
  });
});
