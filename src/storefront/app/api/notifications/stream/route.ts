import type { NextRequest } from "next/server";

import { encodeSseComment } from "@/lib/agent/sse";
import { getNotificationEmitter } from "@/lib/notifications/emitter";
import { NOTIFICATION_EVENT, READY_EVENT, type NotificationEvent } from "@/lib/notifications/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const RETRY_MS = 5_000;
// Notifications are rare; a client this far behind has stalled and is dropped.
const MAX_QUEUED_CHUNKS = 32;

const encoder = new TextEncoder();

function frame(id: string, event: string, data: unknown): Uint8Array {
  return encoder.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function notificationFrame(event: NotificationEvent): Uint8Array {
  return frame(event.id, NOTIFICATION_EVENT, event.block);
}

/** SSE fan-out of webhook notifications; replays buffered events after Last-Event-ID. */
export function GET(request: NextRequest): Response {
  const emitter = getNotificationEmitter();
  const cursor =
    request.headers.get("last-event-id") ?? request.nextUrl.searchParams.get("lastEventId");

  let deliver: (event: NotificationEvent) => void = () => undefined;
  const unsubscribe = emitter.subscribe((event) => deliver(event));
  if (!unsubscribe) {
    return Response.json(
      { error: { code: "unavailable", message: "Too many listeners" } },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } }
    );
  }

  let stop: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let stopped = false;
        const heartbeat = setInterval(() => write(encodeSseComment()), HEARTBEAT_MS);
        const onAbort = () => stop();

        stop = () => {
          if (stopped) return;
          stopped = true;
          clearInterval(heartbeat);
          unsubscribe();
          request.signal.removeEventListener("abort", onAbort);
          try {
            controller.close();
          } catch {
            // Already closed or cancelled.
          }
        };

        function write(chunk: Uint8Array): void {
          if (stopped) return;
          if ((controller.desiredSize ?? 0) <= 0) {
            stop();
            return;
          }
          try {
            controller.enqueue(chunk);
          } catch {
            stop();
          }
        }

        deliver = (event) => write(notificationFrame(event));
        request.signal.addEventListener("abort", onAbort, { once: true });

        // Runs synchronously with subscribe(), so no event can slip between replay and live.
        write(encoder.encode(`retry: ${RETRY_MS}\n\n`));
        for (const event of emitter.since(cursor)) write(notificationFrame(event));
        write(frame(emitter.cursor(), READY_EVENT, {}));
        if (request.signal.aborted) stop();
      },
      cancel() {
        stop();
      },
    },
    { highWaterMark: MAX_QUEUED_CHUNKS }
  );

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
