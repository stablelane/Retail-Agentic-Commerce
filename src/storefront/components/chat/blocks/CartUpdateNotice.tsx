"use client";

import { ShoppingBag } from "lucide-react";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";

/** Confirmation shown when the assistant changed the bag (`cart_update` event). */
export function CartUpdateNotice({ itemCount }: { itemCount: number }) {
  const { viewBag } = useBlockActions();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-4 py-3 text-caption"
    >
      <span className="flex items-center gap-2">
        <ShoppingBag className="size-4 text-primary" aria-hidden="true" />
        {itemCount === 0
          ? "Your bag is now empty."
          : `Bag updated — ${itemCount} ${itemCount === 1 ? "item" : "items"}.`}
      </span>
      <button type="button" onClick={viewBag} className="btn-filled">
        View bag
      </button>
    </div>
  );
}
