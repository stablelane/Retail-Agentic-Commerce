import type { NextRequest } from "next/server";

import { readCappedText } from "@/lib/commerce/mcp-protocol";
import { getWebhookSecret } from "@/lib/env";
import { getNotificationEmitter } from "@/lib/notifications/emitter";
import {
  WEBHOOK_MAX_BODY_BYTES,
  createReplayGuard,
  parseWebhookEvent,
  toNotificationBlock,
  verifyWebhookSignature,
} from "@/lib/notifications/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const replayGuard = createReplayGuard();

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function log(line: string): void {
  // eslint-disable-next-line no-console
  console.info(line);
}

/** Signed ACP webhook from the merchant → notifications emitter (§4.6). */
export async function POST(request: NextRequest): Promise<Response> {
  const secret = getWebhookSecret();
  if (!secret) {
    log("[webhooks] WEBHOOK_SECRET is not set; delivery rejected");
    return errorResponse(500, "misconfigured", "Webhook receiver is not configured");
  }
  if (Number(request.headers.get("content-length") ?? 0) > WEBHOOK_MAX_BODY_BYTES) {
    return errorResponse(413, "payload_too_large", "Payload too large");
  }

  let body: string | null;
  try {
    body = await readCappedText(request.body, WEBHOOK_MAX_BODY_BYTES);
  } catch {
    return errorResponse(400, "bad_request", "Invalid body");
  }
  if (body === null) return errorResponse(413, "payload_too_large", "Payload too large");

  const verdict = verifyWebhookSignature({
    secret,
    body,
    timestamp: request.headers.get("x-webhook-timestamp"),
    signature: request.headers.get("x-webhook-signature"),
  });
  if (!verdict.ok) {
    log(`[webhooks] rejected: ${verdict.reason}`);
    return errorResponse(401, verdict.reason, "Invalid webhook signature");
  }
  if (replayGuard.has(verdict.signature)) return json(200, { received: true, duplicate: true });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return errorResponse(400, "invalid_json", "Invalid JSON payload");
  }
  const parsed = parseWebhookEvent(payload);
  if (!parsed.ok) return errorResponse(400, "invalid_payload", parsed.error);
  replayGuard.add(verdict.signature);

  const { type } = parsed.event;
  const block = toNotificationBlock(parsed.event, new Date().toISOString());
  if (!block) return json(200, { received: true, type });

  const event = getNotificationEmitter().publish(block);
  log(`[webhooks] ${type} order=${block.orderId} event=${event.id}`);
  return json(200, { received: true, type, event_id: event.id });
}
