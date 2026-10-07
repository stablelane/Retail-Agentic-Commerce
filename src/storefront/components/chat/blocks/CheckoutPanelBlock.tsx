"use client";

import Link from "next/link";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { CheckoutPanelBlock as CheckoutPanelBlockData } from "@/lib/agent/types";
import { formatCents } from "@/lib/money";

export function CheckoutPanelBlock({ block }: { block: CheckoutPanelBlockData }) {
  const { navigate } = useBlockActions();
  const count = Math.max(0, Math.trunc(block.itemCount));

  if (count === 0) {
    return (
      <section aria-label="Checkout" className="rounded-card bg-surface p-4 text-caption">
        <p>Your bag is empty — add something first and I&apos;ll take you to checkout.</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Checkout"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4 text-caption"
    >
      <p>
        <span className="font-semibold">
          {count} {count === 1 ? "item" : "items"}
        </span>
        {block.total != null ? <> · {formatCents(block.total)}</> : null}
        <span className="block text-micro text-text-secondary">
          Payment happens securely on the checkout page.
        </span>
      </p>
      <Link href="/checkout" onClick={navigate} className="btn-pill">
        Go to checkout
      </Link>
    </section>
  );
}
