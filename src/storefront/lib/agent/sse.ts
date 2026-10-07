/** SSE framing for `/api/chat`: a server-side encoder and a browser/test-side incremental parser. */

import { CHAT_EVENT_NAMES, type ChatEvent, type ChatEventName } from "@/lib/agent/types";

const encoder = new TextEncoder();

/** Format one event as `event: <name>\ndata: <json>\n\n` (JSON never contains raw newlines). */
export function formatSseEvent(event: ChatEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function encodeSseEvent(event: ChatEvent): Uint8Array {
  return encoder.encode(formatSseEvent(event));
}

/** Comment frame used as a keep-alive while slow tools run; ignored by SSE clients. */
export function encodeSseComment(comment = "ping"): Uint8Array {
  return encoder.encode(`: ${comment.replace(/[\r\n]/g, " ")}\n\n`);
}

function isEventName(value: string): value is ChatEventName {
  return (CHAT_EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * Incremental parser: feed decoded text chunks, get back complete chat events.
 * Unknown event names, comments and non-JSON payloads are skipped.
 */
export function createSseParser(): { push(chunk: string): ChatEvent[]; flush(): ChatEvent[] } {
  let buffer = "";

  function parseFrame(frame: string): ChatEvent | null {
    let name = "message";
    const data: string[] = [];
    for (const line of frame.split(/\r\n|\r|\n/)) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
    }
    if (data.length === 0 || !isEventName(name)) return null;
    try {
      return { event: name, data: JSON.parse(data.join("\n")) } as ChatEvent;
    } catch {
      return null;
    }
  }

  function drain(final: boolean): ChatEvent[] {
    const events: ChatEvent[] = [];
    const frames = buffer.split(/\r\n\r\n|\n\n|\r\r/);
    buffer = final ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      const event = parseFrame(frame);
      if (event) events.push(event);
    }
    return events;
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}
