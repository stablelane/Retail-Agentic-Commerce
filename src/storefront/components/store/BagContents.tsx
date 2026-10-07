"use client";

import Link from "next/link";
import { useState } from "react";

import { useChat } from "@/components/chat/ChatProvider";
import { DiscountInput } from "@/components/store/DiscountInput";
import { LineItemRow } from "@/components/store/LineItemRow";
import { ShippingSelector } from "@/components/store/ShippingSelector";
import { TotalsBlock } from "@/components/store/TotalsBlock";
import type { CheckoutSession } from "@/lib/commerce/acp";
import { cartStore, cartSubtotal, useCart, type SyncStatus } from "@/lib/commerce/cart-store";
import { getSessionSyncer } from "@/lib/commerce/session-sync";
import { cn } from "@/lib/cn";

function SyncStatusLine({ status, sessionId }: { status: SyncStatus; sessionId: string | null }) {
  let text: string;
  if (status === "syncing") text = "Syncing…";
  else if (status === "offline") text = "Offline — will retry";
  else if (status === "error") text = "Couldn't sync your bag — change an item to retry";
  else if (sessionId) text = `Synced to session ${sessionId}`;
  else text = "Not synced yet";
  return (
    <p role="status" className="text-micro break-all text-text-secondary">
      {text}
    </p>
  );
}

/** Shipping options, discount codes and session totals for the current ACP session. */
export function SessionSummary({
  session,
  busy,
}: {
  session: CheckoutSession | null;
  busy: boolean;
}) {
  const { items } = useCart();
  const [shippingError, setShippingError] = useState<string | null>(null);
  const syncer = getSessionSyncer();

  async function selectShipping(optionId: string) {
    setShippingError(null);
    try {
      await syncer.updateSession({ fulfillment_option_id: optionId });
    } catch {
      setShippingError("Couldn't update the delivery option. Please try again.");
    }
  }

  async function changeCodes(codes: string[]) {
    await syncer.updateSession({ discounts: { codes } });
  }

  return (
    <div className="flex flex-col gap-5">
      {session ? (
        <div className="flex flex-col gap-2">
          <ShippingSelector
            options={session.fulfillment_options}
            selectedId={session.fulfillment_option_id}
            disabled={busy}
            onSelect={(optionId) => void selectShipping(optionId)}
          />
          {shippingError ? (
            <p role="alert" className="text-micro text-text">
              {shippingError}
            </p>
          ) : null}
        </div>
      ) : null}
      <DiscountInput
        discounts={session?.discounts}
        disabled={!session || busy}
        onChangeCodes={changeCodes}
      />
      <TotalsBlock totals={session?.totals ?? null} fallbackSubtotal={cartSubtotal(items)} />
    </div>
  );
}

interface BagContentsProps {
  variant: "drawer" | "page";
  /** Called when a link inside the bag navigates away (closes the drawer). */
  onNavigate?: () => void;
}

export function BagContents({ variant, onNavigate }: BagContentsProps) {
  const cart = useCart();
  const { prefillChat } = useChat();

  if (!cart.hydrated) {
    return <p className="text-small text-text-secondary">Loading your bag…</p>;
  }

  if (cart.items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-body">Your bag is empty.</p>
        <Link
          href="/catalog"
          {...(onNavigate ? { onClick: onNavigate } : {})}
          className="btn-primary"
        >
          Continue shopping
        </Link>
      </div>
    );
  }

  const session = cart.session;
  const linesByProduct = new Map(session?.line_items.map((line) => [line.item.id, line]));
  const busy = cart.syncStatus === "syncing";

  return (
    <div
      className={cn(
        variant === "page"
          ? "grid items-start gap-8 lg:grid-cols-[1fr_380px]"
          : "flex flex-col gap-6"
      )}
    >
      <section aria-label="Items">
        <ul className="divide-y divide-line">
          {cart.items.map((item) => (
            <LineItemRow
              key={item.id}
              item={item}
              line={linesByProduct.get(item.id)}
              onQuantityChange={(quantity) => cartStore.setQuantity(item.id, quantity)}
              onRemove={() => cartStore.remove(item.id)}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
        <SyncStatusLine status={cart.syncStatus} sessionId={cart.sessionId} />
      </section>

      <section
        aria-label="Order summary"
        className={cn("flex flex-col gap-5", variant === "page" && "rounded-card bg-surface p-6")}
      >
        <SessionSummary session={session} busy={busy} />
        <div className="flex flex-col gap-2">
          <Link
            href="/checkout"
            {...(onNavigate ? { onClick: onNavigate } : {})}
            className="btn-pill w-full"
          >
            Checkout
          </Link>
          <button
            type="button"
            className="btn-outline w-full"
            onClick={() => {
              onNavigate?.();
              prefillChat("Can you review what's in my bag?");
            }}
          >
            Ask about my bag
          </button>
        </div>
      </section>
    </div>
  );
}
