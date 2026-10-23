import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { AcpRequestError, randomId, type FetchLike } from "@/lib/commerce/acp";

export interface PaymentAuthorization {
  clientSecret: string;
  publishableKey: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
}

/** Ask the storefront server for an authorize-only PaymentIntent for the session's merchant total. */
export async function createPaymentIntent(
  checkoutSessionId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init)
): Promise<PaymentAuthorization> {
  let response: Response;
  try {
    response = await fetchImpl("/api/stripe/payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomId("pi") },
      body: JSON.stringify({ checkoutSessionId }),
      cache: "no-store",
    });
  } catch {
    throw new AcpRequestError("The store is unreachable. Check your connection.", 0);
  }
  const body = (await response.json().catch(() => null)) as
    (PaymentAuthorization & { error?: { message?: string } }) | null;
  if (!response.ok || !body?.clientSecret) {
    throw new AcpRequestError(
      body?.error?.message ?? "We couldn't start the payment. Please try again.",
      response.status
    );
  }
  return body;
}

const stripePromises = new Map<string, Promise<Stripe | null>>();

/** One Stripe.js instance per publishable key; the script is only fetched when payment starts. */
export function getStripe(publishableKey: string): Promise<Stripe | null> {
  let promise = stripePromises.get(publishableKey);
  if (!promise) {
    promise = loadStripe(publishableKey);
    stripePromises.set(publishableKey, promise);
  }
  return promise;
}
