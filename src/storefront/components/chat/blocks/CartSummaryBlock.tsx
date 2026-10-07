"use client";

import Image from "next/image";
import Link from "next/link";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { CartSummaryBlock as CartSummaryBlockData } from "@/lib/agent/types";
import { productImageSrc } from "@/lib/commerce/catalog";
import { formatCents } from "@/lib/money";

export function CartSummaryBlock({ block }: { block: CartSummaryBlockData }) {
  const { navigate, viewBag } = useBlockActions();
  const items = block.items.filter((item) => typeof item.id === "string");
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <section aria-label="Your bag" className="rounded-card bg-surface p-4 text-caption">
      {items.length === 0 ? (
        <p>Your bag is empty.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <Image
                  src={productImageSrc(item.imageUrl)}
                  alt=""
                  width={40}
                  height={40}
                  sizes="40px"
                  className="size-10 shrink-0 rounded-badge object-cover"
                />
                <span className="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
                <span className="shrink-0 text-text-secondary">
                  {item.quantity} × {formatCents(item.price)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
            {block.totals && block.totals.length > 0 ? (
              block.totals.map((total) => (
                <div
                  key={total.type}
                  className={
                    total.type === "total"
                      ? "flex justify-between font-semibold"
                      : "flex justify-between"
                  }
                >
                  <dt>{total.display_text}</dt>
                  <dd>{formatCents(total.amount)}</dd>
                </div>
              ))
            ) : (
              <>
                <div className="flex justify-between font-semibold">
                  <dt>Subtotal</dt>
                  <dd>{formatCents(subtotal)}</dd>
                </div>
                <p className="text-micro text-text-secondary">
                  Taxes and shipping calculated at checkout
                </p>
              </>
            )}
          </dl>
        </>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {items.length > 0 ? (
          <Link href="/checkout" onClick={navigate} className="btn-pill">
            Go to checkout
          </Link>
        ) : null}
        <button type="button" onClick={viewBag} className="btn-filled">
          View bag
        </button>
      </div>
    </section>
  );
}
