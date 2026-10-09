"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { useBag } from "@/components/store/BagProvider";
import { cartStore, MAX_LINE_QUANTITY, type CartProduct } from "@/lib/commerce/cart-store";
import { formatSessionWhen } from "@/lib/commerce/catalog";
import type { EventSessionSummary } from "@/lib/commerce/merchant";
import { INPUT_CLASS } from "@/components/store/FormField";

/** Quantity stepper + Add to bag; adds to the cart and opens the bag drawer. */
export function AddToBag({
  product,
  stockCount,
  label = "Add to bag",
}: {
  product: CartProduct;
  stockCount: number;
  label?: string;
}) {
  const { openBag } = useBag();
  const max = Math.max(1, Math.min(MAX_LINE_QUANTITY, stockCount));
  const [quantity, setQuantity] = useState(1);
  const soldOut = stockCount <= 0;
  const productName = product.name;

  function addToBag() {
    if (soldOut) return;
    cartStore.add(product, quantity, max);
    setQuantity(1);
    openBag();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Quantity" className="flex items-center gap-1">
        <button
          type="button"
          className="btn-primary size-10 p-0"
          aria-label={`Decrease quantity of ${productName}`}
          disabled={quantity <= 1 || soldOut}
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <output aria-live="polite" className="w-8 text-center text-body font-semibold">
          {quantity}
        </output>
        <button
          type="button"
          className="btn-primary size-10 p-0"
          aria-label={`Increase quantity of ${productName}`}
          disabled={quantity >= max || soldOut}
          onClick={() => setQuantity((q) => Math.min(max, q + 1))}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="btn-pill"
        disabled={soldOut}
        onClick={addToBag}
        {...(soldOut ? { "aria-describedby": "add-to-bag-note" } : {})}
      >
        {soldOut ? "Sold out" : label}
      </button>
      {soldOut ? (
        <p id="add-to-bag-note" className="w-full text-micro text-text-secondary">
          Out of stock.
        </p>
      ) : null}
    </div>
  );
}

/** Session picker. The bag line id is the session id, capped at seats left. */
export function BookSeats({
  product,
  sessions,
}: {
  product: CartProduct;
  sessions: readonly EventSessionSummary[];
}) {
  const firstOpen = sessions.find((session) => session.seats_left > 0) ?? sessions[0];
  const [sessionId, setSessionId] = useState(firstOpen?.id ?? "");
  const selected = sessions.find((session) => session.id === sessionId) ?? firstOpen;
  if (!selected) return <AddToBag product={product} stockCount={0} label="Book seats" />;

  const booked: CartProduct = {
    ...product,
    id: selected.id,
    name: `${product.name} · ${formatSessionWhen(selected.starts_at, true)}`,
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-small font-semibold">
        Date
        <select
          value={selected.id}
          onChange={(event) => setSessionId(event.target.value)}
          className={INPUT_CLASS}
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id} disabled={session.seats_left <= 0}>
              {formatSessionWhen(session.starts_at, true)} · {session.seats_left} seats left
            </option>
          ))}
        </select>
      </label>
      <AddToBag product={booked} stockCount={selected.seats_left} label="Book seats" />
    </div>
  );
}
