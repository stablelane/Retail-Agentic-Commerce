"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { UpiPaymentBlock as UpiPaymentBlockData } from "@/lib/agent/types";
import { orderHref } from "@/lib/commerce/orders";
import { saveRecentOrder } from "@/lib/commerce/recent-orders";
import { formatPaise } from "@/lib/money";

function truncate(value: string, length = 18): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

/** Outcome of a UPI ReservePay payment (feature 20). */
export function UpiPaymentBlock({ block }: { block: UpiPaymentBlockData }) {
  const { navigate } = useBlockActions();
  const { status, orderId, email, total } = block;

  useEffect(() => {
    if (status === "paid" && orderId) {
      saveRecentOrder({ id: orderId, email, placedAt: new Date().toISOString(), total });
    }
  }, [status, orderId, email, total]);

  if (status === "paid") {
    return (
      <section aria-label="UPI payment" className="rounded-card bg-surface p-4 text-caption">
        <p className="font-semibold">Paid {total != null ? formatPaise(total) : ""} via UPI</p>
        {block.receipt ? (
          <p className="text-micro text-text-secondary" title={block.receipt}>
            Receipt {truncate(block.receipt)}
          </p>
        ) : null}
        {orderId ? (
          <Link href={orderHref(orderId, email)} onClick={navigate} className="btn-filled mt-3">
            View order
          </Link>
        ) : null}
        <p className="mt-2 text-micro text-text-secondary">
          Charged in INR by the Pine Labs sandbox; your order shows the same amount in AED.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="UPI payment" className="rounded-card bg-surface p-4 text-caption">
      <p className="font-semibold">
        {status === "pending"
          ? "Payment is processing"
          : status === "refused"
            ? "Payment refused by your spending limits"
            : "Payment failed"}
      </p>
      {block.reason ? <p className="text-text-secondary">{block.reason}</p> : null}
      {status === "refused" ? (
        <p className="mt-2 text-micro text-text-secondary">
          Try a smaller bag or set up a larger UPI mandate.
        </p>
      ) : null}
      {status === "failed" ? (
        <Link href="/checkout" onClick={navigate} className="btn-pill mt-3">
          Try the checkout page
        </Link>
      ) : null}
    </section>
  );
}
