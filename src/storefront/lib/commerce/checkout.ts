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
  address?: AcpAddressInput;
  card: CardDetails;
  language: Language;
  onStep?: (step: CheckoutStep) => void;
  fetchImpl?: FetchLike;
}

export interface PlacedOrder {
  orderId: string;
  session: CheckoutSession;
}

export interface PrepareSessionParams {
  session: CheckoutSession;
  buyer: AcpBuyerInput;
  address?: AcpAddressInput | undefined;
  fetchImpl?: FetchLike | undefined;
}

/** Push buyer/fulfillment and require `ready_for_payment` with a positive merchant total. */
export async function prepareSessionForPayment({
  session,
  buyer,
  address,
  fetchImpl,
}: PrepareSessionParams): Promise<{ ready: CheckoutSession; amount: number }> {
  const fulfillmentOptionId = preferredFulfillmentOptionId(session);
  const ready = await proxyRequest<CheckoutSession>("merchant", sessionPath(session.id), {
    method: "POST",
    body: {
      buyer,
      ...(address ? { fulfillment_address: address } : {}),
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
  return { ready, amount };
}

export interface CompleteSessionParams {
  sessionId: string;
  buyer: AcpBuyerInput;
  token: string;
  provider: string;
  language: Language;
  address?: AcpAddressInput | undefined;
  fetchImpl?: FetchLike | undefined;
}

export async function completeSession({
  sessionId,
  buyer,
  token,
  provider,
  language,
  address,
  fetchImpl,
}: CompleteSessionParams): Promise<PlacedOrder> {
  const completed = await proxyRequest<CheckoutSession>(
    "merchant",
    sessionPath(sessionId, "complete"),
    {
      method: "POST",
      body: {
        buyer,
        payment_data: {
          token,
          provider,
          ...(address ? { billing_address: address } : {}),
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
  const { ready, amount } = await prepareSessionForPayment({ session, buyer, address, fetchImpl });

  onStep?.("authorizing");
  const token = await delegatePayment(
    {
      card,
      amount,
      currency: ready.currency,
      checkoutSessionId: ready.id,
      ...(address ? { billingAddress: address } : {}),
    },
    fetchImpl
  );

  onStep?.("completing");
  return completeSession({
    sessionId: ready.id,
    buyer,
    token,
    provider: ready.payment_provider?.provider ?? "stripe",
    language,
    address,
    fetchImpl,
  });
}
