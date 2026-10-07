/** Browser client for `POST /api/chat`: streams SSE frames over `fetch` and yields typed events. */

import { createSseParser } from "@/lib/agent/sse";
import type { ChatEvent, ChatRequest } from "@/lib/agent/types";

export const CHAT_ENDPOINT = "/api/chat";

const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Pre-stream failure (rate limit, validation, server error) reported with an HTTP status. */
export class ChatHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ChatHttpError";
    this.status = status;
    this.code = code;
  }
}

interface StreamChatOptions {
  signal?: AbortSignal | undefined;
  onEvent: (event: ChatEvent) => void;
  fetchImpl?: typeof fetch | undefined;
}

async function readError(response: Response): Promise<ChatHttpError> {
  let code = "http_error";
  let message =
    response.status === 429 ? "Too many messages. Try again in a minute." : GENERIC_ERROR;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.message === "string" && body.error.message) {
      message = body.error.message;
    }
  } catch {
    // Non-JSON error body; keep the generic message.
  }
  return new ChatHttpError(response.status, code, message);
}

/**
 * Send one chat turn and dispatch each SSE event as it arrives. Resolves when the stream ends;
 * rejects with `ChatHttpError` before the stream starts, or with an `AbortError` when cancelled.
 */
export async function streamChat(request: ChatRequest, options: StreamChatOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request),
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw await readError(response);
  if (!response.body) throw new ChatHttpError(response.status, "empty_body", GENERIC_ERROR);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      options.signal?.throwIfAborted();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        options.onEvent(event);
      }
    }
    for (const event of parser.push(decoder.decode())) options.onEvent(event);
    for (const event of parser.flush()) options.onEvent(event);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
