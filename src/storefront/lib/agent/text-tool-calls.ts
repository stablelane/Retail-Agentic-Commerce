/**
 * Some NIM models (e.g. Nemotron) occasionally write tool calls into the message text
 * instead of the structured `tool_calls` field, as
 * `<tool_call><function=name><parameter=key>value</parameter></function></tool_call>`
 * or `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`. This filter keeps that
 * markup out of the visible reply and recovers the calls.
 */

export interface TextToolCall {
  name: string;
  arguments: string;
}

const OPEN = "<tool_call>";
const MAX_CAPTURE_CHARS = 8000;

function heldPrefixLength(text: string): number {
  for (let length = Math.min(OPEN.length - 1, text.length); length > 0; length -= 1) {
    if (OPEN.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

function parseValue(raw: string): unknown {
  const value = raw.trim();
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseTextToolCalls(markup: string): TextToolCall[] {
  const calls: TextToolCall[] = [];
  const blocks = markup.split(OPEN).slice(1);
  for (const block of blocks) {
    const body = block.split("</tool_call>")[0] ?? "";
    const xml = /<function=([\w-]+)>([\s\S]*?)(?:<\/function>|$)/.exec(body);
    if (xml?.[1]) {
      const args: Record<string, unknown> = {};
      for (const match of (xml[2] ?? "").matchAll(
        /<parameter=([\w-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/g
      )) {
        if (match[1]) args[match[1]] = parseValue(match[2] ?? "");
      }
      calls.push({ name: xml[1], arguments: JSON.stringify(args) });
      continue;
    }
    try {
      const parsed = JSON.parse(body.trim()) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name === "string") {
        const args =
          typeof parsed.arguments === "string"
            ? parsed.arguments
            : JSON.stringify(parsed.arguments ?? {});
        calls.push({ name: parsed.name, arguments: args });
      }
    } catch {
      // Unparseable markup is dropped rather than shown to the shopper.
    }
  }
  return calls;
}

export function createTextToolCallFilter() {
  let held = "";
  let capture: string | null = null;

  return {
    /** Returns the text that is safe to show now. */
    push(delta: string): string {
      if (capture !== null) {
        if (capture.length < MAX_CAPTURE_CHARS) capture += delta;
        return "";
      }
      const text = held + delta;
      const start = text.indexOf(OPEN);
      if (start >= 0) {
        capture = text.slice(start);
        held = "";
        return text.slice(0, start);
      }
      const keep = heldPrefixLength(text);
      held = text.slice(text.length - keep);
      return text.slice(0, text.length - keep);
    },
    /** Remaining visible text and any tool calls recovered from the markup. */
    finish(): { text: string; calls: TextToolCall[] } {
      const text = capture === null ? held : "";
      const calls = capture === null ? [] : parseTextToolCalls(capture);
      held = "";
      capture = null;
      return { text, calls };
    },
  };
}
