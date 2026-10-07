import type { ChatEvent, ChatRequest } from "@/lib/agent/types";
import { ChatHttpError, isAbortError, streamChat } from "@/lib/chat/sse-client";

const encoder = new TextEncoder();

const REQUEST: ChatRequest = {
  messages: [{ role: "user", content: "Show me tops" }],
  cart: { sessionId: null, items: [] },
  context: { page: "home" },
};

function sseResponse(chunks: Array<string | Uint8Array>, init: ResponseInit = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

async function collect(response: Response, signal?: AbortSignal): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await streamChat(REQUEST, {
    signal,
    fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
    onEvent: (event) => events.push(event),
  });
  return events;
}

const FRAMES =
  'event: tool_status\ndata: {"tool":"search_products","label":"Searching the catalog…"}\n\n' +
  'event: text\ndata: {"delta":"Café — "}\n\n' +
  'event: text\ndata: {"delta":"fresh picks"}\n\n' +
  'event: done\ndata: {"steps":1,"fallback":false}\n\n';

const EXPECTED: ChatEvent[] = [
  { event: "tool_status", data: { tool: "search_products", label: "Searching the catalog…" } },
  { event: "text", data: { delta: "Café — " } },
  { event: "text", data: { delta: "fresh picks" } },
  { event: "done", data: { steps: 1, fallback: false } },
];

describe("streamChat", () => {
  it("posts the request as JSON and asks for an event stream", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse([FRAMES]));
    await streamChat(REQUEST, { fetchImpl, onEvent: () => undefined });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/api/chat");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    });
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST);
  });

  it("parses several events delivered in one chunk", async () => {
    expect(await collect(sseResponse([FRAMES]))).toEqual(EXPECTED);
  });

  it.each([1, 2, 3, 7, 16])(
    "reassembles events split every %i bytes, including inside multi-byte characters",
    async (size) => {
      const bytes = encoder.encode(FRAMES);
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < bytes.length; offset += size) {
        chunks.push(bytes.slice(offset, offset + size));
      }
      expect(await collect(sseResponse(chunks))).toEqual(EXPECTED);
    }
  );

  it("accepts CRLF framing and flushes a final frame without a trailing blank line", async () => {
    const events = await collect(
      sseResponse([
        'event: text\r\ndata: {"delta":"Hi"}\r\n\r\n',
        'event: done\r\ndata: {"steps":0,"fallback":true}',
      ])
    );
    expect(events).toEqual([
      { event: "text", data: { delta: "Hi" } },
      { event: "done", data: { steps: 0, fallback: true } },
    ]);
  });

  it("skips malformed frames, comments and unknown events without stopping", async () => {
    const events = await collect(
      sseResponse([
        ": ping\n\n",
        "event: text\ndata: {not json}\n\n",
        'event: mystery\ndata: {"a":1}\n\n',
        "event: text\n\n",
        "garbage line without a colon\n\n",
        'event: text\ndata: {"delta":"ok"}\n\n',
        'event: done\ndata: {"steps":1,"fallback":false}\n\n',
      ])
    );
    expect(events).toEqual([
      { event: "text", data: { delta: "ok" } },
      { event: "done", data: { steps: 1, fallback: false } },
    ]);
  });

  it("throws ChatHttpError with the server's message for non-2xx responses", async () => {
    const response = Response.json(
      { error: { code: "rate_limited", message: "Too many messages. Try again in a minute." } },
      { status: 429 }
    );
    const error = await collect(response).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChatHttpError);
    expect(error).toMatchObject({
      status: 429,
      code: "rate_limited",
      message: "Too many messages. Try again in a minute.",
    });
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    const error = await collect(new Response("upstream exploded", { status: 500 })).catch(
      (caught: unknown) => caught
    );
    expect(error).toMatchObject({
      status: 500,
      message: "Something went wrong. Please try again.",
    });
  });

  it("stops reading and rejects with an AbortError when cancelled mid-stream", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode('event: text\ndata: {"delta":"partial"}\n\n'));
        // Never closes: only the abort can end this stream.
      },
    });
    const events: ChatEvent[] = [];
    const run = streamChat(REQUEST, {
      signal: controller.signal,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      onEvent: (event) => {
        events.push(event);
        controller.abort();
      },
    });

    const error = await run.catch((caught: unknown) => caught);
    expect(isAbortError(error)).toBe(true);
    expect(events).toEqual([{ event: "text", data: { delta: "partial" } }]);
  });
});
