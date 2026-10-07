"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";

import { useBag } from "@/components/store/BagProvider";
import { cartStore, MAX_LINE_QUANTITY, type CartProduct } from "@/lib/commerce/cart-store";

/** Quantity stepper + Add to bag; adds to the cart and opens the bag drawer. */
export function AddToBag({ product, stockCount }: { product: CartProduct; stockCount: number }) {
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
        {soldOut ? "Sold out" : "Add to bag"}
      </button>
      {soldOut ? (
        <p id="add-to-bag-note" className="w-full text-micro text-text-secondary">
          Out of stock.
        </p>
      ) : null}
    </div>
  );
}
