import type { NextRequest } from "next/server";
import Stripe from "stripe";

import { clientKey, createRateLimiter } from "@/lib/agent/rate-limit";
import { findTotal } from "@/lib/commerce/acp";
import { MerchantApiError, getCheckoutSession } from "@/lib/commerce/merchant";
import { getStripeConfig } from "@/lib/env";
import { isCrossOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_ID = /^checkout_[A-Za-z0-9]{1,64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const perClientMinute = createRateLimiter(10, 60_000);

let cached: { secretKey: string; client: Stripe } | null = null;

function stripeClient(secretKey: string): Stripe {
  if (cached?.secretKey !== secretKey) cached = { secretKey, client: new Stripe(secretKey) };
  return cached.client;
}

function error(status: number, message: string): Response {
  return Response.json(
    { error: { message } },
    { status, headers: { "cache-control": "no-store" } }
  );
}

/** Authorize-only PaymentIntent for the merchant's current session total; the merchant captures on completion. */
export async function POST(request: NextRequest): Promise<Response> {
  if (isCrossOrigin(request)) return error(403, "Forbidden");
  if (!perClientMinute.take(clientKey(request.headers))) {
    return error(429, "Too many payment attempts. Try again in a minute.");
  }
  const config = getStripeConfig();
  if (!config) return error(503, "Card payments are not available right now.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON");
  }
  const sessionId = (body as { checkoutSessionId?: unknown } | null)?.checkoutSessionId;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return error(400, "Invalid checkout session");
  }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return error(400, "Missing Idempotency-Key");
  }

  let session;
  try {
    session = await getCheckoutSession(sessionId);
  } catch (cause) {
    return error(cause instanceof MerchantApiError ? 502 : 500, "The store is unavailable.");
  }
  if (!session) return error(404, "Checkout session not found");
  if (session.status !== "ready_for_payment") {
    return error(409, "Your order is missing some details. Please review them.");
  }
  const amount = findTotal(session.totals, "total");
  if (amount === null || amount <= 0) return error(409, "We couldn't calculate your order total.");

  try {
    const intent = await stripeClient(config.secretKey).paymentIntents.create(
      {
        amount,
        currency: session.currency.toLowerCase(),
        capture_method: "manual",
        allowed_payment_method_types: ["card"],
        metadata: { checkout_session_id: session.id },
      },
      { idempotencyKey }
    );
    if (!intent.client_secret) return error(502, "Payment provider returned no client secret.");
    return Response.json(
      {
        clientSecret: intent.client_secret,
        publishableKey: config.publishableKey,
        paymentIntentId: intent.id,
        amount,
        currency: session.currency,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (cause) {
    // Stripe messages can echo masked keys; keep details server-side.
    // eslint-disable-next-line no-console
    console.error("[stripe] PaymentIntent create failed", (cause as Error).message);
    return error(502, "We couldn't start the payment. Please try again.");
  }
}
