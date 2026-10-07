import {
  findTotal,
  proxyRequest,
  sessionPath,
  type AcpAddressInput,
  type AcpBuyerInput,
  type CheckoutSession,
  type FetchLike,
} from "@/lib/commerce/acp";
import { delegatePayment, type CardDetails } from "@/lib/commerce/psp";
import { preferredFulfillmentOptionId } from "@/lib/commerce/session-sync";

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

export type CheckoutStep = "updating" | "authorizing" | "completing";

export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutError";
  }
}

export interface PlaceOrderParams {
  session: CheckoutSession;
  buyer: AcpBuyerInput;
  address: AcpAddressInput;
  card: CardDetails;
  language: Language;
  onStep?: (step: CheckoutStep) => void;
  fetchImpl?: FetchLike;
}

export interface PlacedOrder {
  orderId: string;
  session: CheckoutSession;
}

/** ACP checkout: update session → PSP delegate_payment → complete session. */
export async function placeOrder({
  session,
  buyer,
  address,
  card,
  language,
  onStep,
  fetchImpl,
}: PlaceOrderParams): Promise<PlacedOrder> {
  onStep?.("updating");
  const fulfillmentOptionId = preferredFulfillmentOptionId(session);
  const ready = await proxyRequest<CheckoutSession>("merchant", sessionPath(session.id), {
    method: "POST",
    body: {
      buyer,
      fulfillment_address: address,
      ...(fulfillmentOptionId ? { fulfillment_option_id: fulfillmentOptionId } : {}),
    },
    fetchImpl,
  });

  if (ready.status !== "ready_for_payment") {
    const reason = ready.messages.find((message) => message.type === "error")?.content;
    throw new CheckoutError(reason ?? "Your order is missing some details. Please review them.");
  }

  const amount = findTotal(ready.totals, "total");
  if (amount === null || amount <= 0) {
    throw new CheckoutError("We couldn't calculate your order total. Please try again.");
  }

  onStep?.("authorizing");
  const token = await delegatePayment(
    {
      card,
      amount,
      currency: ready.currency,
      checkoutSessionId: ready.id,
      billingAddress: address,
    },
    fetchImpl
  );

  onStep?.("completing");
  const completed = await proxyRequest<CheckoutSession>(
    "merchant",
    sessionPath(ready.id, "complete"),
    {
      method: "POST",
      body: {
        buyer,
        payment_data: {
          token,
          provider: ready.payment_provider?.provider ?? "stripe",
          billing_address: address,
        },
        preferred_language: language,
      },
      fetchImpl,
    }
  );

  if (completed.status !== "completed" || !completed.order) {
    throw new CheckoutError("We couldn't confirm your order. Please try again.");
  }
  return { orderId: completed.order.id, session: completed };
}
