import { createSseParser, encodeSseComment, encodeSseEvent, formatSseEvent } from "@/lib/agent/sse";
import type { ChatEvent } from "@/lib/agent/types";

describe("formatSseEvent", () => {
  it("frames an event as event/data lines terminated by a blank line", () => {
    expect(formatSseEvent({ event: "text", data: { delta: "Hi" } })).toBe(
      'event: text\ndata: {"delta":"Hi"}\n\n'
    );
  });

  it("escapes newlines inside payloads so a frame stays on one data line", () => {
    const frame = formatSseEvent({ event: "text", data: { delta: "a\n\nevent: done" } });
    expect(frame.split("\n")).toHaveLength(4);
    expect(frame).toContain('"a\\n\\nevent: done"');
  });

  it("encodes to UTF-8 bytes", () => {
    const bytes = encodeSseEvent({ event: "done", data: { steps: 1, fallback: false } });
    expect(new TextDecoder().decode(bytes)).toBe(
      'event: done\ndata: {"steps":1,"fallback":false}\n\n'
    );
  });

  it("encodes keep-alive comments without allowing injected lines", () => {
    expect(new TextDecoder().decode(encodeSseComment("a\nevent: x"))).toBe(": a event: x\n\n");
  });
});

describe("createSseParser", () => {
  const events: ChatEvent[] = [
    { event: "text", data: { delta: "Here you go" } },
    { event: "tool_status", data: { tool: "get_cart", label: "Checking your bag…" } },
    {
      event: "block",
      data: { type: "checkout_panel", sessionId: null, total: null, itemCount: 2 },
    },
    { event: "done", data: { steps: 1, fallback: true } },
  ];

  it("round-trips events split across arbitrary chunk boundaries", () => {
    const wire = ": ping\n\n" + events.map(formatSseEvent).join("");
    const parser = createSseParser();
    const received: ChatEvent[] = [];
    for (let i = 0; i < wire.length; i += 7) received.push(...parser.push(wire.slice(i, i + 7)));
    received.push(...parser.flush());
    expect(received).toEqual(events);
  });

  it("skips unknown event names and invalid JSON", () => {
    const parser = createSseParser();
    const out = parser.push("event: evil\ndata: {}\n\nevent: text\ndata: {oops\n\n");
    expect(out).toEqual([]);
  });
});
