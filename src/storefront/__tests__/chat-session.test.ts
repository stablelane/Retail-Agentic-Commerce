import type { CartUpdateItem, ChatEvent, UIBlock } from "@/lib/agent/types";
import { applyCartUpdate } from "@/lib/chat/cart-update";
import { chatContextFromPath } from "@/lib/chat/page-context";
import {
  INITIAL_CHAT_STATE,
  buildHistory,
  chatReducer,
  composerPlaceholder,
  isRenderableBlock,
  parseChatState,
  serializeChatState,
  type ChatAction,
  type ChatState,
} from "@/lib/chat/session";
import { createCartStore } from "@/lib/commerce/cart-store";

const CAROUSEL: UIBlock = {
  type: "product_carousel",
  title: "Tops",
  products: [{ id: "prod_1", name: "Classic Tee", price: 2500, imageUrl: "/prod_1.jpeg" }],
};

function run(actions: ChatAction[], state: ChatState = INITIAL_CHAT_STATE): ChatState {
  return actions.reduce(chatReducer, state);
}

function event(id: string, chatEvent: ChatEvent): ChatAction {
  return { type: "event", id, event: chatEvent };
}

describe("chatReducer", () => {
  it("starts a streaming turn and shows it", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "Track my order", intent: "track_order" },
    ]);
    expect(state.activeIndex).toBe(0);
    expect(state.turns[0]).toMatchObject({
      id: "t1",
      prompt: "Track my order",
      intent: "track_order",
      status: "streaming",
      items: [],
    });
  });

  it("merges text deltas and interleaves blocks in emitted order", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "Tops" },
      event("t1", { event: "text", data: { delta: "Here " } }),
      event("t1", { event: "text", data: { delta: "you go." } }),
      event("t1", { event: "tool_status", data: { tool: "list_catalog", label: "Browsing…" } }),
      event("t1", { event: "block", data: CAROUSEL }),
      event("t1", { event: "text", data: { delta: "Anything else?" } }),
    ]);
    const turn = state.turns[0]!;
    expect(turn.items).toEqual([
      { kind: "text", text: "Here you go." },
      { kind: "block", block: CAROUSEL },
      { kind: "text", text: "Anything else?" },
    ]);
    expect(turn.toolStatus).toBeNull();
  });

  it("shows tool status until the block lands", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "Tops" },
      event("t1", { event: "tool_status", data: { tool: "list_catalog", label: "Browsing…" } }),
    ]);
    expect(state.turns[0]!.toolStatus).toBe("Browsing…");
  });

  it("ignores unknown or malformed blocks", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "x" },
      event("t1", { event: "block", data: { type: "hologram" } as unknown as UIBlock }),
      event("t1", {
        event: "block",
        data: { type: "product_carousel", title: "x" } as unknown as UIBlock,
      }),
    ]);
    expect(state.turns[0]!.items).toEqual([]);
  });

  it("records cart updates, errors, suggestions and completion", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "Add a tee" },
      event("t1", {
        event: "cart_update",
        data: {
          sessionId: null,
          items: [
            {
              id: "prod_1",
              name: "Tee",
              price: 2500,
              imageUrl: "/a.jpeg",
              quantity: 2,
              maxQuantity: 10,
            },
          ],
        },
      }),
      event("t1", { event: "error", data: { code: "merchant_unavailable", message: "Offline" } }),
      event("t1", { event: "suggestions", data: { chips: ["A", "B", "C", "D", "E"] } }),
      event("t1", { event: "done", data: { steps: 1, fallback: true } }),
      event("t1", { event: "text", data: { delta: "late" } }),
    ]);
    const turn = state.turns[0]!;
    expect(turn.items).toEqual([
      { kind: "cart_update", itemCount: 2 },
      { kind: "error", message: "Offline" },
    ]);
    expect(turn.suggestions).toEqual(["A", "B", "C", "D"]);
    expect(turn.status).toBe("done");
  });

  it("marks failures and cancellations without touching finished turns", () => {
    const failed = run([
      { type: "start", id: "t1", prompt: "x" },
      { type: "fail", id: "t1", message: "Offline" },
    ]);
    expect(failed.turns[0]).toMatchObject({ status: "error", error: "Offline" });

    const cancelled = run([
      { type: "start", id: "t1", prompt: "x" },
      { type: "cancel", id: "t1" },
      { type: "fail", id: "t1", message: "late" },
    ]);
    expect(cancelled.turns[0]).toMatchObject({ status: "cancelled", error: null });
  });

  it("steps back to the empty state and forward again without losing turns", () => {
    let state = run([
      { type: "start", id: "t1", prompt: "one" },
      { type: "finish", id: "t1" },
      { type: "start", id: "t2", prompt: "two" },
    ]);
    expect(state.activeIndex).toBe(1);
    state = run([{ type: "back" }, { type: "back" }, { type: "back" }], state);
    expect(state.activeIndex).toBe(-1);
    expect(state.turns).toHaveLength(2);
    state = run([{ type: "forward" }, { type: "forward" }, { type: "forward" }], state);
    expect(state.activeIndex).toBe(1);
  });

  it("resets to an empty conversation", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "one" },
      { type: "finish", id: "t1" },
      { type: "reset" },
    ]);
    expect(state).toEqual({ turns: [], activeIndex: -1 });
  });

  it("toggles feedback", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "x" },
      { type: "feedback", id: "t1", value: "up" },
    ]);
    expect(state.turns[0]!.feedback).toBe("up");
    expect(run([{ type: "feedback", id: "t1", value: "up" }], state).turns[0]!.feedback).toBeNull();
  });

  it("adds notification cards and shows them", () => {
    const block: UIBlock = {
      type: "notification",
      subject: "On its way",
      message: "Your order shipped.",
      status: "order_shipped",
      orderId: "order_1",
      trackingUrl: null,
      receivedAt: "2026-01-01T00:00:00Z",
    };
    const state = run([
      { type: "start", id: "t1", prompt: "x" },
      { type: "finish", id: "t1" },
      { type: "notify", id: "n1", block },
    ]);
    expect(state.activeIndex).toBe(1);
    expect(state.turns[1]).toMatchObject({ source: "notification", prompt: "On its way" });
    expect(buildHistory(state.turns)).toEqual([{ role: "user", content: "x" }]);
  });
});

describe("buildHistory", () => {
  it("alternates user prompts with assistant text and block summaries", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "Show tops" },
      event("t1", { event: "text", data: { delta: "Here are some tops." } }),
      event("t1", { event: "block", data: CAROUSEL }),
      { type: "finish", id: "t1" },
      { type: "start", id: "t2", prompt: "still streaming" },
    ]);
    expect(buildHistory(state.turns)).toEqual([
      { role: "user", content: "Show tops" },
      {
        role: "assistant",
        content: "Here are some tops.\n[Showed products: Classic Tee (prod_1)]",
      },
    ]);
  });

  it("caps history so the new prompt fits the 20-message limit", () => {
    let state = INITIAL_CHAT_STATE;
    for (let index = 0; index < 15; index += 1) {
      state = run(
        [
          { type: "start", id: `t${index}`, prompt: `q${index}` },
          event(`t${index}`, { event: "text", data: { delta: `a${index}` } }),
          { type: "finish", id: `t${index}` },
        ],
        state
      );
    }
    const history = buildHistory(state.turns);
    expect(history).toHaveLength(19);
    expect(history.at(-1)).toEqual({ role: "assistant", content: "a14" });
  });
});

describe("composerPlaceholder", () => {
  it.each([
    [undefined, "What can I help you with today?"],
    ["order_form", "Need more details?"],
    ["product_carousel", "What else would you like to know?"],
    ["checkout_panel", "Anything else for your bag?"],
    [null, "Ask a follow-up…"],
  ] as const)("after %s → %s", (blockType, expected) => {
    if (blockType === undefined) {
      expect(composerPlaceholder(undefined)).toBe(expected);
      return;
    }
    const blocks: Record<string, UIBlock> = {
      order_form: { type: "order_form", prefill: { email: "a@b.co" } },
      product_carousel: CAROUSEL,
      checkout_panel: { type: "checkout_panel", sessionId: null, total: null, itemCount: 1 },
    };
    const actions: ChatAction[] = [{ type: "start", id: "t1", prompt: "x" }];
    if (blockType) actions.push(event("t1", { event: "block", data: blocks[blockType]! }));
    expect(composerPlaceholder(run(actions).turns[0])).toBe(expected);
  });
});

describe("isRenderableBlock", () => {
  it("accepts every contract block type and rejects others", () => {
    expect(isRenderableBlock(CAROUSEL)).toBe(true);
    expect(
      isRenderableBlock({ type: "cart_summary", items: [], totals: null, sessionId: null })
    ).toBe(true);
    expect(isRenderableBlock({ type: "account_summary", name: "John" })).toBe(true);
    expect(
      isRenderableBlock({ type: "order_status", orderId: "order_1", status: "delivered" })
    ).toBe(true);
    expect(isRenderableBlock({ type: "script" })).toBe(false);
    expect(isRenderableBlock(null)).toBe(false);
    expect(isRenderableBlock({ type: "order_form" })).toBe(false);
  });
});

describe("chat state persistence", () => {
  it("round-trips finished turns and turns interrupted streams into cancelled ones", () => {
    const state = run([
      { type: "start", id: "t1", prompt: "Tops" },
      event("t1", { event: "block", data: CAROUSEL }),
    ]);
    const restored = parseChatState(serializeChatState(state));
    expect(restored?.activeIndex).toBe(0);
    expect(restored?.turns[0]).toMatchObject({ status: "cancelled", items: [{ kind: "block" }] });
  });

  it("drops corrupt storage", () => {
    expect(parseChatState("{")).toBeNull();
    expect(parseChatState(JSON.stringify({ turns: [{ id: 1 }] }))?.turns).toEqual([]);
  });
});

describe("chatContextFromPath", () => {
  it.each([
    ["/", { page: "home" }],
    [null, { page: "home" }],
    ["/catalog", { page: "shop" }],
    ["/products/prod_3", { page: "pdp", productId: "prod_3" }],
    ["/products/not-a-product", { page: "pdp" }],
    ["/bag", { page: "bag" }],
    ["/checkout", { page: "checkout" }],
    ["/orders", { page: "orders" }],
    ["/orders/order_abc-1", { page: "orders", orderId: "order_abc-1" }],
    ["/account", { page: "account" }],
    ["/contact", { page: "contact" }],
    ["/somewhere/else", { page: "home" }],
  ])("%s", (pathname, expected) => {
    expect(chatContextFromPath(pathname)).toEqual(expected);
  });
});

describe("applyCartUpdate", () => {
  function line(id: string, quantity: number, price = 2500): CartUpdateItem {
    return { id, name: id, price, imageUrl: `/${id}.jpeg`, quantity, maxQuantity: 10 };
  }

  it("replaces the cart contents through the store API", () => {
    const store = createCartStore(null);
    store.add({ id: "prod_1", name: "prod_1", price: 2500, imageUrl: "/prod_1.jpeg" }, 1);
    store.add({ id: "prod_2", name: "prod_2", price: 2500, imageUrl: "/prod_2.jpeg" }, 1);

    applyCartUpdate([line("prod_1", 3, 2400), line("prod_5", 2)], store);

    expect(
      store.getSnapshot().items.map(({ id, quantity, price }) => ({ id, quantity, price }))
    ).toEqual([
      { id: "prod_1", quantity: 3, price: 2400 },
      { id: "prod_5", quantity: 2, price: 2500 },
    ]);
  });

  it("does not touch lines that are already up to date", () => {
    const store = createCartStore(null);
    store.add({ id: "prod_1", name: "prod_1", price: 2500, imageUrl: "/prod_1.jpeg" }, 2);
    const add = vi.spyOn(store, "add");
    const remove = vi.spyOn(store, "remove");
    applyCartUpdate([line("prod_1", 2)], store);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("empties the cart", () => {
    const store = createCartStore(null);
    store.add({ id: "prod_1", name: "prod_1", price: 2500, imageUrl: "/prod_1.jpeg" }, 2);
    applyCartUpdate([], store);
    expect(store.getSnapshot().items).toEqual([]);
  });
});
