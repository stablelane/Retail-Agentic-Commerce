import type { NextRequest } from "next/server";

import { runChatTurn, type ChatTurnDeps } from "@/lib/agent/agent";
import { createChatLlm } from "@/lib/agent/client";
import { createExecutor } from "@/lib/agent/executor";
import { clientKey, createRateLimiter } from "@/lib/agent/rate-limit";
import { parseChatRequest } from "@/lib/agent/request";
import { encodeSseComment, encodeSseEvent } from "@/lib/agent/sse";
import { CHAT_LIMITS, type ChatErrorCode, type ChatEvent } from "@/lib/agent/types";
import { BRAND_NAME } from "@/lib/brand";
import { readCappedText } from "@/lib/commerce/mcp-protocol";
import { getLlmConfig } from "@/lib/env";
import { isCrossOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HEARTBEAT_MS = 15_000;
const MAX_CONCURRENT_TURNS = 5;

const perClientMinute = createRateLimiter(10, MINUTE_MS);
const perClientDay = createRateLimiter(100, DAY_MS);
// Per-client limits scale with the number of IPs; these cap total LLM spend.
const globalHour = createRateLimiter(200, HOUR_MS);
const globalDay = createRateLimiter(1000, DAY_MS);
let activeTurns = 0;

function errorResponse(
  status: number,
  code: ChatErrorCode | "forbidden" | "unsupported_media_type" | "payload_too_large",
  message: string,
  headers: Record<string, string> = {}
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store", ...headers } }
  );
}

function log(line: string): void {
  // eslint-disable-next-line no-console
  console.info(line);
}

/** SSE agent loop (§5.1). Pre-stream failures are plain JSON errors with an HTTP status. */
export async function POST(request: NextRequest): Promise<Response> {
  if (isCrossOrigin(request)) return errorResponse(403, "forbidden", "Forbidden");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "unsupported_media_type", "Expected application/json");
  }
  const client = clientKey(request.headers);
  if (!perClientMinute.take(client)) {
    return errorResponse(429, "rate_limited", "Too many messages. Try again in a minute.", {
      "retry-after": String(MINUTE_MS / 1000),
    });
  }
  if (!perClientDay.take(client)) {
    return errorResponse(429, "rate_limited", "Daily message limit reached. Try again tomorrow.", {
      "retry-after": String(HOUR_MS / 1000),
    });
  }
  if (Number(request.headers.get("content-length") ?? 0) > CHAT_LIMITS.maxBodyBytes) {
    return errorResponse(413, "payload_too_large", "Payload too large");
  }

  let raw: string | null;
  try {
    raw = await readCappedText(request.body, CHAT_LIMITS.maxBodyBytes);
  } catch {
    return errorResponse(400, "bad_request", "Invalid body");
  }
  if (raw === null) return errorResponse(413, "payload_too_large", "Payload too large");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(400, "bad_request", "Invalid JSON");
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return errorResponse(400, "bad_request", parsed.error);

  if (activeTurns >= MAX_CONCURRENT_TURNS) {
    return errorResponse(503, "rate_limited", "The assistant is busy. Try again in a moment.", {
      "retry-after": "5",
    });
  }
  if (!globalHour.take("all") || !globalDay.take("all")) {
    return errorResponse(
      429,
      "rate_limited",
      "The assistant has reached its usage limit. Try again later.",
      { "retry-after": String(HOUR_MS / 1000) }
    );
  }

  const config = getLlmConfig();
  const deps: ChatTurnDeps = {
    llm: createChatLlm(config, log),
    executor: createExecutor(),
    maxToolSteps: config.maxToolSteps,
    brandName: BRAND_NAME,
    log,
  };

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let doneSent = false;
      const write = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };
      const emit = (event: ChatEvent) => {
        if (doneSent) return;
        if (event.event === "done") doneSent = true;
        write(encodeSseEvent(event));
      };
      const heartbeat = setInterval(() => write(encodeSseComment()), HEARTBEAT_MS);

      activeTurns += 1;
      try {
        await runChatTurn(parsed.request, emit, deps, abort.signal);
      } catch {
        log("[chat] turn failed");
        emit({
          event: "error",
          data: { code: "internal_error", message: "Something went wrong. Please try again." },
        });
      } finally {
        activeTurns -= 1;
        clearInterval(heartbeat);
        if (!abort.signal.aborted) emit({ event: "done", data: { steps: 0, fallback: true } });
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
