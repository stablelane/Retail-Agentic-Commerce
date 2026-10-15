"use client";

import { useEffect, useState } from "react";

import type { UpiMandateBlock as UpiMandateBlockData } from "@/lib/agent/types";
import { safeHttpUrl } from "@/lib/commerce/orders";
import { formatPaise } from "@/lib/money";

const ACTIVE = "ACTIVE";
const POLL_MS = 2000;
const POLL_LIMIT_MS = 60_000;

/** UPI ReservePay mandate (feature 20); polls the PSP until Pine Labs approves it. */
export function UpiMandateBlock({ block }: { block: UpiMandateBlockData }) {
  const [status, setStatus] = useState(block.status);
  const active = status === ACTIVE;

  useEffect(() => {
    if (active) return;
    const started = Date.now();
    const url = `/api/proxy/psp/upi/mandates/${encodeURIComponent(block.mandateId)}`;
    const timer = window.setInterval(() => {
      if (Date.now() - started > POLL_LIMIT_MS) {
        window.clearInterval(timer);
        return;
      }
      fetch(url, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { status?: unknown } | null) => {
          if (typeof data?.status === "string") setStatus(data.status);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, block.mandateId]);

  const deepLink = safeHttpUrl(block.deepLink);

  return (
    <section aria-label="UPI mandate" className="rounded-card bg-surface p-4 text-caption">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">UPI ReservePay</span>
        <span
          role="status"
          className="rounded-sale bg-primary-tint px-2 py-0.5 text-[11px] font-semibold text-primary"
        >
          {active ? "Active" : `Waiting for approval (${status.toLowerCase()})`}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-micro text-text-secondary">Blocked</dt>
          <dd className="text-title font-semibold">{formatPaise(block.amountBlocked)}</dd>
        </div>
        <div>
          <dt className="text-micro text-text-secondary">Mobile</dt>
          <dd className="text-title font-semibold">{block.mobile}</dd>
        </div>
      </dl>
      {!active && deepLink ? (
        <a href={deepLink} target="_blank" rel="noopener noreferrer" className="btn-pill mt-3">
          Open UPI app
        </a>
      ) : null}
      <p className="mt-2 text-micro text-text-secondary">Sandbox: approves automatically.</p>
    </section>
  );
}
