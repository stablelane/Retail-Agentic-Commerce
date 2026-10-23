"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import Link from "next/link";
import { useState } from "react";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import { AcpRequestError, findTotal } from "@/lib/commerce/acp";
import { cartStore, useCart } from "@/lib/commerce/cart-store";
import { CheckoutError, completeSession, prepareSessionForPayment } from "@/lib/commerce/checkout";
import { orderHref } from "@/lib/commerce/orders";
import { saveRecentOrder } from "@/lib/commerce/recent-orders";
import { getSessionSyncer } from "@/lib/commerce/session-sync";
import { createPaymentIntent, getStripe, type PaymentAuthorization } from "@/lib/commerce/stripe";
import { MOCK_BUYER } from "@/lib/commerce/user";
import { formatCents } from "@/lib/money";

type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "ready"; sessionId: string; auth: PaymentAuthorization }
  | { kind: "done"; orderId: string };

const APPEARANCE: Appearance = {
  theme: "stripe",
  variables: { colorPrimary: "#312e81", borderRadius: "8px" },
};

function paymentErrorMessage(error: unknown): string {
  if (error instanceof CheckoutError) return error.message;
  if (error instanceof AcpRequestError && !error.message.startsWith("Request failed")) {
    return error.message;
  }
  return "We couldn't complete the payment. Please try again.";
}

/** Inline Stripe Payment Element: authorize in the browser, merchant captures on completion. */
export function StripePaymentPanel({ total }: { total: number | null }) {
  const cart = useCart();
  const { navigate } = useBlockActions();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  if (phase.kind === "done") {
    return (
      <div role="status" className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">Payment received — your booking is confirmed.</p>
        <Link
          href={orderHref(phase.orderId, MOCK_BUYER.email, true)}
          onClick={navigate}
          className="btn-pill"
        >
          View order
        </Link>
      </div>
    );
  }

  if (cart.hydrated && cart.items.length === 0) {
    return <p>This checkout is no longer active — your bag is empty.</p>;
  }

  async function start() {
    setError(null);
    setPhase({ kind: "preparing" });
    try {
      const prepared = await getSessionSyncer().withSyncedSession(async (current) => {
        const { ready } = await prepareSessionForPayment({ session: current, buyer: MOCK_BUYER });
        return { sessionId: ready.id, auth: await createPaymentIntent(ready.id) };
      });
      setPhase({ kind: "ready", ...prepared });
    } catch (cause) {
      setError(paymentErrorMessage(cause));
      setPhase({ kind: "idle" });
    }
  }

  if (phase.kind === "ready") {
    return (
      <Elements
        stripe={getStripe(phase.auth.publishableKey)}
        options={{ clientSecret: phase.auth.clientSecret, appearance: APPEARANCE }}
      >
        <PaymentForm
          sessionId={phase.sessionId}
          amount={phase.auth.amount}
          onPaid={(orderId) => setPhase({ kind: "done", orderId })}
          onRestart={() => setPhase({ kind: "idle" })}
        />
      </Elements>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-micro text-text-secondary">
          Pay securely here — card details go straight to Stripe.
        </p>
        <button
          type="button"
          onClick={start}
          disabled={phase.kind === "preparing" || !cart.hydrated}
          className="btn-pill"
        >
          {phase.kind === "preparing"
            ? "Preparing…"
            : `Pay${total != null ? ` ${formatCents(total)}` : ""}`}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-micro text-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface PaymentFormProps {
  sessionId: string;
  amount: number;
  onPaid: (orderId: string) => void;
  onRestart: () => void;
}

function PaymentForm({ sessionId, amount, onPaid, onRestart }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once authorized, a PaymentIntent can't be confirmed again; retries need a fresh one.
  const [needsRestart, setNeedsRestart] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({ elements, redirect: "if_required" });
      if (result.error) {
        setError(result.error.message ?? "Your card could not be authorized.");
        return;
      }
      if (result.paymentIntent.status !== "requires_capture") {
        setError("Your card could not be authorized.");
        setNeedsRestart(true);
        return;
      }
      const paymentIntentId = result.paymentIntent.id;
      const placed = await getSessionSyncer().withSyncedSession((current) => {
        if (current.id !== sessionId) {
          throw new CheckoutError("Your bag changed while paying. Please start again.");
        }
        return completeSession({
          sessionId,
          buyer: MOCK_BUYER,
          token: paymentIntentId,
          provider: "stripe",
          language: "en",
        });
      });
      saveRecentOrder({
        id: placed.orderId,
        email: MOCK_BUYER.email,
        placedAt: new Date().toISOString(),
        total: findTotal(placed.session.totals, "total"),
      });
      cartStore.clear();
      onPaid(placed.orderId);
    } catch (cause) {
      setError(paymentErrorMessage(cause));
      setNeedsRestart(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Card payment" className="flex flex-col gap-3">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? (
        <p role="alert" className="text-micro text-text">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {needsRestart ? (
          <button type="button" onClick={onRestart} className="btn-pill">
            Start over
          </button>
        ) : (
          <button type="submit" disabled={!stripe || !elements || busy} className="btn-pill">
            {busy ? "Processing…" : `Pay ${formatCents(amount)}`}
          </button>
        )}
      </div>
    </form>
  );
}
