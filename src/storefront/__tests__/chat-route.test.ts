// @vitest-environment node
import { NextRequest } from "next/server";

import { POST } from "@/app/api/chat/route";
import { createSseParser } from "@/lib/agent/sse";
import type { ChatEvent } from "@/lib/agent/types";

vi.mock("server-only", () => ({}));

const ORIGIN = "http://localhost:3002";
const NIM_URL = "http://nim.test/v1/chat/completions";
const SECRET_KEY = "nvapi-test-secret";

const PRODUCTS = [
  {
    id: "prod_1",
    sku: "TS-001",
    name: "Classic Tee",
    base_price: 2500,
    compare_at_price: null,
    stock_count: 100,
    min_margin: 0.2,
    image_url: "/prod_1.jpeg",
    category: "tops",
    subcategory: null,
    description: "Soft cotton tee",
    attributes: [],
  },
  {
    id: "prod_3",
    sku: "TS-003",
    name: "Graphic Tee",
    base_price: 3200,
    compare_at_price: 4000,
    stock_count: 50,
    min_margin: 0.2,
    image_url: "/prod_3.jpeg",
    category: "tops",
    subcategory: null,
    description: "Bold print tee",
    attributes: [],
  },
];

const fetchMock = vi.fn<typeof fetch>();
let llmResponses: Response[] = [];

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function llmStream(...frames: string[]): Response {
  return new Response(frames.join("") + "data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

function toolCallStream(name: string, args: Record<string, unknown>, lead?: string): Response {
  const json = JSON.stringify(args);
  return llmStream(
    ...(lead === undefined ? [] : [chunk({ role: "assistant", content: lead })]),
    chunk({
      role: "assistant",
      tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: "" } }],
    }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(0, 10) } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(10) } }] }),
    chunk({}, "tool_calls")
  );
}

function textStream(...parts: string[]): Response {
  return llmStream(...parts.map((content) => chunk({ content })), chunk({}, "stop"));
}

function body(content: string, extra: Record<string, unknown> = {}) {
  return {
    messages: [{ role: "user", content }],
    cart: { sessionId: null, items: [] },
    context: { page: "home" },
    ...extra,
  };
}

function request(payload: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      host: "localhost:3002",
      "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`,
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

async function readEvents(response: Response): Promise<{ events: ChatEvent[]; raw: string }> {
  const raw = await response.text();
  const parser = createSseParser();
  return { events: [...parser.push(raw), ...parser.flush()], raw };
}

function llmCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url) === NIM_URL);
}

beforeEach(() => {
  llmResponses = [];
  vi.stubEnv("AZURE_OPENAI_API_KEY", "");
  vi.stubEnv("NVIDIA_API_KEY", SECRET_KEY);
  vi.stubEnv("NIM_LLM_BASE_URL", "http://nim.test/v1");
  vi.stubEnv("NIM_LLM_MODEL_NAME", "test-model");
  vi.stubEnv("MERCHANT_API_URL", "http://merchant.test");
  vi.stubEnv("MERCHANT_API_KEY", "merchant-secret");
  vi.stubEnv("MCP_SERVER_URL", "http://mcp.test");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === NIM_URL) {
      const next = llmResponses.shift();
      if (!next) throw new Error("unexpected LLM call");
      return next;
    }
    if (url.startsWith("http://merchant.test/products")) {
      return Response.json({ products: PRODUCTS, total: PRODUCTS.length, category: null });
    }
    if (url.startsWith("http://mcp.test/api/mcp")) {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [],
          isError: false,
          structuredContent: {
            products: [{ id: "prod_3", name: "Graphic Tee", basePrice: 3200, stockCount: 50 }],
          },
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/chat", () => {
  it("runs the LLM tool loop and streams events in order", async () => {
    llmResponses = [
      toolCallStream("search_products", { query: "tees", title: "Fresh tees" }, "\n\n"),
      textStream("The Graphic Tee ", "is on sale."),
    ];

    const response = await POST(request(body("Show me some tops")));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);

    const { events, raw } = await readEvents(response);
    expect(events.map((event) => event.event)).toEqual([
      "tool_status",
      "block",
      "text",
      "text",
      "suggestions",
      "done",
    ]);
    expect(events[0]).toEqual({
      event: "tool_status",
      data: { tool: "search_products", label: "Searching the catalog…" },
    });
    expect(events[1]).toMatchObject({
      event: "block",
      data: {
        type: "product_carousel",
        title: "Fresh tees",
        products: [{ id: "prod_3", price: 3200, compareAtPrice: 4000 }],
      },
    });
    expect(events.at(-1)).toEqual({ event: "done", data: { steps: 1, fallback: false } });
    expect(events.filter((event) => event.event === "text").map((event) => event.data)).toEqual([
      { delta: "The Graphic Tee " },
      { delta: "is on sale." },
    ]);
    expect(raw).not.toContain(SECRET_KEY);
    expect(raw).not.toContain("merchant-secret");

    const calls = llmCalls();
    expect(calls).toHaveLength(2);
    const [, init] = calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${SECRET_KEY}`);
    const first = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(first).toMatchObject({
      model: "test-model",
      stream: true,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 600,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect((first.tools as unknown[]).length).toBe(13);

    const second = JSON.parse(String(calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string | null }>;
    };
    const toolMessage = second.messages.find((message) => message.role === "tool");
    expect(JSON.parse(toolMessage?.content ?? "{}")).toMatchObject({
      products: [{ id: "prod_3", price_cents: 3200 }],
    });
  });

  it("feeds invalid tool arguments back to the model without calling backends", async () => {
    llmResponses = [
      toolCallStream("add_to_cart", { product_id: "../admin", quantity: 99 }),
      textStream("Sorry, I couldn't add that."),
    ];
    const { events } = await readEvents(await POST(request(body("add it"))));
    expect(events.map((event) => event.event)).toEqual(["tool_status", "text", "done"]);
    expect(fetchMock.mock.calls.every(([url]) => String(url) === NIM_URL)).toBe(true);
  });

  it("emits cart_update for cart tools", async () => {
    llmResponses = [
      toolCallStream("update_cart", { product_id: "prod_1", quantity: 2 }, "On it."),
      textStream("Done."),
    ];
    const { events } = await readEvents(await POST(request(body("make it two"))));
    expect(events.map((event) => event.event)).toEqual([
      "text",
      "tool_status",
      "block",
      "cart_update",
      "text",
      "text",
      "suggestions",
      "done",
    ]);
    expect(events.filter((event) => event.event === "text").map((event) => event.data)).toEqual([
      { delta: "On it." },
      { delta: "\n\n" },
      { delta: "Done." },
    ]);
    expect(events[3]).toMatchObject({
      event: "cart_update",
      data: { items: [{ id: "prod_1", quantity: 2, maxQuantity: 10 }], sessionId: null },
    });
  });

  it("answers chips deterministically without calling the LLM", async () => {
    const { events } = await readEvents(await POST(request(body("Track my order"))));
    expect(llmCalls()).toHaveLength(0);
    expect(events.map((event) => event.event)).toEqual([
      "text",
      "tool_status",
      "block",
      "suggestions",
      "done",
    ]);
    expect(events[2]).toEqual({
      event: "block",
      data: { type: "order_form", prefill: { email: "john@example.com" }, reason: "missing_id" },
    });
    expect(events.at(-1)).toEqual({ event: "done", data: { steps: 1, fallback: true } });
  });

  it("uses the keyword router when no API key is configured", async () => {
    vi.stubEnv("NVIDIA_API_KEY", "");
    const { events } = await readEvents(await POST(request(body("What's on sale?"))));
    expect(llmCalls()).toHaveLength(0);
    expect(events.find((event) => event.event === "block")).toMatchObject({
      data: { type: "product_carousel", products: [{ id: "prod_3" }] },
    });
    expect(events.at(-1)).toEqual({ event: "done", data: { steps: 1, fallback: true } });
  });

  it("falls back with an error event when the LLM is unreachable", async () => {
    llmResponses = [
      Response.json({ error: { message: `bad key ${SECRET_KEY}` } }, { status: 500 }),
    ];
    const { events, raw } = await readEvents(await POST(request(body("Where is my order?"))));
    expect(events.map((event) => event.event)).toEqual([
      "error",
      "text",
      "tool_status",
      "block",
      "suggestions",
      "done",
    ]);
    expect(events[0]).toMatchObject({ data: { code: "llm_unavailable" } });
    expect(events.at(-1)).toEqual({ event: "done", data: { steps: 1, fallback: true } });
    expect(raw).not.toContain(SECRET_KEY);
  });

  it.each([
    ["missing cart", { messages: [{ role: "user", content: "hi" }], context: { page: "home" } }],
    ["unknown field", { ...body("hi"), admin: true }],
    ["too many messages", body("hi", { messages: Array(21).fill({ role: "user", content: "x" }) })],
    ["message too long", body("x".repeat(2001))],
    ["assistant last", body("hi", { messages: [{ role: "assistant", content: "hello" }] })],
    [
      "bad product id in cart",
      body("hi", { cart: { sessionId: null, items: [{ id: "x", quantity: 1 }] } }),
    ],
    [
      "quantity over 10",
      body("hi", { cart: { sessionId: null, items: [{ id: "prod_1", quantity: 11 }] } }),
    ],
    ["bad session id", body("hi", { cart: { sessionId: "../x", items: [] } })],
    ["unknown intent", body("hi", { intent: "admin" })],
    ["unknown page", body("hi", { context: { page: "admin" } })],
  ])("rejects %s with 400", async (_label, payload) => {
    const response = await POST(request(payload));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "bad_request" } });
  });

  it("rejects invalid JSON, wrong content type and cross-origin posts", async () => {
    expect((await POST(request("{nope"))).status).toBe(400);
    expect((await POST(request(body("hi"), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(body("hi"), { origin: "https://evil.example" }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    const response = await POST(request({ ...body("hi"), pad: "x".repeat(70 * 1024) }));
    expect(response.status).toBe(413);
  });
});
