import {
  CHAT_INTENTS,
  FOLLOW_UP_SUGGESTIONS,
  getChatIntent,
  intentFromText,
  isChatIntentId,
} from "@/lib/agent/intents";
import {
  detectCategory,
  extractOrderReference,
  routeIntent,
  routeMessage,
} from "@/lib/agent/router";
import { parseToolCall, TOOL_NAMES } from "@/lib/agent/tools";

vi.mock("server-only", () => ({}));

const noContext = { cartItems: [] };

describe("intents", () => {
  it("lists the five chips in spec order with icons", () => {
    expect(CHAT_INTENTS.map((intent) => [intent.label, intent.icon])).toEqual([
      ["Plan my weekend", "sparkles"],
      ["Track my order", "truck"],
      ["Family days out", "search"],
      ["Live shows", "search"],
      ["Sports events", "list"],
    ]);
  });

  it.each([
    ["help_me_choose", "list_catalog", { limit: 8 }],
    ["track_order", "track_order", {}],
    ["weekend_trip", "search_products", { query: "family days out", limit: 6 }],
    ["gift_runner", "search_products", { category: "live-entertainment", limit: 6 }],
    ["pairs_with_classic_tee", "list_catalog", { category: "sports" }],
  ] as const)("maps %s to %s", (id, tool, args) => {
    const intent = getChatIntent(id);
    expect(intent.tool).toBe(tool);
    expect(intent.args).toMatchObject(args);
  });

  it("every intent maps to valid tool arguments", () => {
    for (const intent of CHAT_INTENTS) {
      expect(parseToolCall(intent.tool, intent.args).ok).toBe(true);
    }
  });

  it("only Help me choose prefers the LLM", () => {
    expect(CHAT_INTENTS.filter((intent) => intent.preferLlm).map((intent) => intent.id)).toEqual([
      "help_me_choose",
    ]);
  });

  it("matches typed chip labels case- and punctuation-insensitively", () => {
    expect(intentFromText("track my order")?.id).toBe("track_order");
    expect(intentFromText("  sports events  ")?.id).toBe("pairs_with_classic_tee");
    expect(intentFromText("Track my order please")).toBeNull();
  });

  it("validates intent ids", () => {
    expect(isChatIntentId("gift_runner")).toBe(true);
    expect(isChatIntentId("drop_tables")).toBe(false);
  });

  it("has at most four follow-ups for every tool", () => {
    for (const name of TOOL_NAMES) {
      expect(FOLLOW_UP_SUGGESTIONS[name].length).toBeGreaterThan(0);
      expect(FOLLOW_UP_SUGGESTIONS[name].length).toBeLessThanOrEqual(4);
    }
  });
});

describe("routeIntent", () => {
  it("runs the chip tool with canned text", () => {
    const turn = routeIntent(getChatIntent("gift_runner"), "Live shows");
    expect(turn).toMatchObject({
      name: "search_products",
      args: { category: "live-entertainment" },
    });
    expect(turn.text).toMatch(/concert/i);
  });

  it("parses order id and email from an order form submission", () => {
    const turn = routeIntent(
      getChatIntent("track_order"),
      "Track order order_AB12-x for jane@example.com"
    );
    expect(turn).toEqual({
      name: "track_order",
      args: { order_id: "order_AB12-x", email: "jane@example.com" },
      text: "Here's the latest on your order.",
    });
  });

  it("shows the form for the bare chip", () => {
    expect(routeIntent(getChatIntent("track_order"), "Track my order").args).toEqual({});
  });
});

describe("routeMessage (keyword fallback)", () => {
  it.each([
    ["Where is my order?", "track_order"],
    ["track order_123", "track_order"],
    ["What's on sale?", "list_catalog"],
    ["Show me my bag", "get_cart"],
    ["what's in my cart", "get_cart"],
    ["I want to checkout", "start_checkout"],
    ["pay now", "pay_with_upi"],
    ["set up upi", "setup_upi_mandate"],
    ["How many points do I have?", "get_account"],
    ["My loyalty status", "get_account"],
    ["Show me some concerts", "search_products"],
    ["something warm for winter", "search_products"],
  ])("%s → %s", (message, tool) => {
    expect(routeMessage(message, noContext).name).toBe(tool);
  });

  it("extracts the order id when present", () => {
    expect(routeMessage("where is order_abc123?", noContext).args).toEqual({
      order_id: "order_abc123",
    });
  });

  it("filters to sale items", () => {
    expect(routeMessage("any deals?", noContext).args).toMatchObject({ on_sale_only: true });
  });

  it("recommends for the viewed product, then the first cart item", () => {
    expect(
      routeMessage("what goes with this?", { productId: "prod_5", cartItems: [] }).args
    ).toMatchObject({
      product_id: "prod_5",
    });
    expect(
      routeMessage("recommend something to pair", { cartItems: [{ id: "prod_9", quantity: 1 }] })
        .args
    ).toMatchObject({ product_id: "prod_9" });
    expect(routeMessage("recommend something", noContext).name).toBe("list_catalog");
  });

  it("searches with the message and a detected category", () => {
    const turn = routeMessage("Show me some concerts", noContext);
    expect(turn.args).toMatchObject({
      query: "Show me some concerts",
      category: "live-entertainment",
      title: "Live entertainment",
    });
    expect(parseToolCall(turn.name, turn.args).ok).toBe(true);
  });

  it("caps the query length so routed args always validate", () => {
    const turn = routeMessage("x".repeat(500), noContext);
    expect(parseToolCall(turn.name, turn.args).ok).toBe(true);
  });
});

describe("router helpers", () => {
  it("extracts order references", () => {
    expect(extractOrderReference("nothing here")).toEqual({});
    expect(extractOrderReference("order_x1 a.b@c.io")).toEqual({
      orderId: "order_x1",
      email: "a.b@c.io",
    });
  });

  it("detects categories from synonyms", () => {
    expect(detectCategory("new concerts")).toBe("live-entertainment");
    expect(detectCategory("a theme park")).toBe("attractions");
    expect(detectCategory("hello")).toBeNull();
  });
});
