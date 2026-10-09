import { proxyRequest, type AcpAddressInput, type FetchLike } from "@/lib/commerce/acp";

export const DEMO_MERCHANT_ID = "merchant_matter";
const TOKEN_TTL_MS = 60 * 60 * 1000;

/** PSP test card used when `NEXT_PUBLIC_DEMO_PREFILL` is enabled. */
export const DEMO_CARD = {
  number: "4242 4242 4242 4242",
  expiry: "12/30",
  cvc: "123",
} as const;

export interface CardDetails {
  /** Digits only, 13–19 long. */
  number: string;
  /** Two-digit month, e.g. "07". */
  expMonth: string;
  /** Four-digit year, e.g. "2030". */
  expYear: string;
}

export interface DelegatePaymentParams {
  card: CardDetails;
  amount: number;
  currency: string;
  checkoutSessionId: string;
  billingAddress?: AcpAddressInput;
  now?: Date;
}

export function normalizeCardNumber(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** Parse "MM/YY" or "MM/YYYY"; null when invalid. */
export function parseExpiry(value: string): { expMonth: string; expYear: string } | null {
  const match = /^\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  const month = Number(match[1]);
  if (month < 1 || month > 12) return null;
  const year = match[2].length === 2 ? `20${match[2]}` : match[2];
  return { expMonth: String(month).padStart(2, "0"), expYear: year };
}

export function buildDelegatePaymentRequest({
  card,
  amount,
  currency,
  checkoutSessionId,
  billingAddress,
  now = new Date(),
}: DelegatePaymentParams) {
  return {
    payment_method: {
      type: "card",
      card_number_type: "fpan",
      virtual: false,
      number: card.number,
      exp_month: card.expMonth,
      exp_year: card.expYear,
      display_card_funding_type: "credit",
      display_last4: card.number.slice(-4),
    },
    allowance: {
      reason: "one_time",
      max_amount: amount,
      currency,
      checkout_session_id: checkoutSessionId,
      merchant_id: DEMO_MERCHANT_ID,
      expires_at: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
    },
    risk_signals: [{ type: "card_testing", action: "authorized" }],
    ...(billingAddress
      ? {
          billing_address: {
            name: billingAddress.name,
            line_one: billingAddress.line_one,
            line_two: billingAddress.line_two ?? null,
            city: billingAddress.city,
            state: billingAddress.state,
            country: billingAddress.country,
            postal_code: billingAddress.postal_code,
          },
        }
      : {}),
  };
}

/** Exchange card details for a single-use vault token via the PSP proxy. */
export async function delegatePayment(
  params: DelegatePaymentParams,
  fetchImpl?: FetchLike
): Promise<string> {
  const response = await proxyRequest<{ id: string }>("psp", "/agentic_commerce/delegate_payment", {
    method: "POST",
    body: buildDelegatePaymentRequest(params),
    fetchImpl,
  });
  return response.id;
}
