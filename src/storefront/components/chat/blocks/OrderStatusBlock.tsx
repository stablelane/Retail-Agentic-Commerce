"use client";

import Link from "next/link";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { OrderStatusBlock as OrderStatusBlockData } from "@/lib/agent/types";
import { cn } from "@/lib/cn";
import {
  SHIPPING_STEPS,
  formatOrderDate,
  formatOrderDateTime,
  orderHref,
  safeHttpUrl,
} from "@/lib/commerce/orders";
import { formatCents } from "@/lib/money";

export function OrderStatusBlock({ block }: { block: OrderStatusBlockData }) {
  const { navigate, email } = useBlockActions();
  const currentIndex = Math.max(
    0,
    SHIPPING_STEPS.findIndex((step) => step.status === block.status)
  );
  const reachedAt = new Map(
    (Array.isArray(block.statusHistory) ? block.statusHistory : []).map((event) => [
      event.status,
      event.at,
    ])
  );
  const trackingUrl = safeHttpUrl(block.trackingUrl);
  const items = Array.isArray(block.items) ? block.items : [];

  return (
    <section aria-label={`Order ${block.orderId}`} className="flex flex-col gap-4 text-caption">
      <ol aria-label="Order progress" className="grid grid-cols-4 gap-1">
        {SHIPPING_STEPS.map((step, index) => {
          const state =
            index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          const at = state === "upcoming" ? undefined : reachedAt.get(step.status);
          return (
            <li
              key={step.status}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              className="flex flex-col gap-1.5"
            >
              <span className="flex items-center gap-1" aria-hidden="true">
                <span
                  className={cn(
                    "size-3 shrink-0 rounded-full",
                    state === "current" && "bg-primary",
                    state === "complete" && "bg-primary-soft",
                    state === "upcoming" && "bg-surface-strong"
                  )}
                />
                {index < SHIPPING_STEPS.length - 1 ? (
                  <span
                    className={cn(
                      "h-0.5 flex-1 rounded-pill",
                      index < currentIndex ? "bg-primary-soft" : "bg-surface-strong"
                    )}
                  />
                ) : null}
              </span>
              <span
                className={cn(
                  "text-micro font-semibold",
                  state === "upcoming" && "text-text-secondary",
                  state === "current" && "text-primary"
                )}
              >
                {step.label}
                {state === "current" ? <span className="sr-only"> (current step)</span> : null}
              </span>
              {at ? (
                <time dateTime={at} className="text-[11px] text-text-secondary">
                  {formatOrderDateTime(at)}
                </time>
              ) : null}
            </li>
          );
        })}
      </ol>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-card bg-surface p-4">
        <dt className="text-text-secondary">Order</dt>
        <dd className="break-all">{block.orderId}</dd>
        {block.carrier ? (
          <>
            <dt className="text-text-secondary">Carrier</dt>
            <dd>{block.carrier}</dd>
          </>
        ) : null}
        {trackingUrl ? (
          <>
            <dt className="text-text-secondary">Tracking</dt>
            <dd>
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                Track package
              </a>
            </dd>
          </>
        ) : null}
        {block.estimatedDelivery ? (
          <>
            <dt className="text-text-secondary">Estimated delivery</dt>
            <dd>{formatOrderDate(block.estimatedDelivery)}</dd>
          </>
        ) : null}
        {items.length > 0 ? (
          <>
            <dt className="text-text-secondary">Items</dt>
            <dd>{items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</dd>
          </>
        ) : null}
        <dt className="text-text-secondary">Total</dt>
        <dd className="font-semibold">{formatCents(block.total)}</dd>
      </dl>

      <Link
        href={orderHref(block.orderId, email)}
        onClick={navigate}
        className="btn-filled self-start"
      >
        View order details
      </Link>
    </section>
  );
}
