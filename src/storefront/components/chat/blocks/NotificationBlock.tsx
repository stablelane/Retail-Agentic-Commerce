"use client";

import Link from "next/link";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { NotificationBlock as NotificationBlockData } from "@/lib/agent/types";
import { SHIPPING_STEPS, formatOrderDateTime, orderHref, safeHttpUrl } from "@/lib/commerce/orders";

function statusLabel(status: string): string {
  return SHIPPING_STEPS.find((step) => step.status === status)?.label ?? status.replace(/_/g, " ");
}

export function NotificationBlock({ block }: { block: NotificationBlockData }) {
  const { navigate, email } = useBlockActions();
  const trackingUrl = safeHttpUrl(block.trackingUrl);

  return (
    <section aria-label="Order update" className="rounded-card bg-surface p-4 text-caption">
      <div className="flex flex-wrap items-center gap-2">
        {block.status ? (
          <span className="rounded-pill bg-primary-tint px-2 py-0.5 text-[11px] font-semibold text-primary">
            {statusLabel(block.status)}
          </span>
        ) : null}
        {block.receivedAt ? (
          <time dateTime={block.receivedAt} className="text-micro text-text-secondary">
            {formatOrderDateTime(block.receivedAt)}
          </time>
        ) : null}
      </div>
      <p className="mt-2 text-small leading-normal whitespace-pre-line">{block.message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href={orderHref(block.orderId, email)} onClick={navigate} className="btn-filled">
          View order
        </Link>
        {trackingUrl ? (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-caption font-semibold text-primary underline-offset-2 hover:underline"
          >
            Track package
          </a>
        ) : null}
      </div>
    </section>
  );
}
