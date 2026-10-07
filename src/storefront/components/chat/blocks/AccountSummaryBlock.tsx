"use client";

import Link from "next/link";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { AccountSummaryBlock as AccountSummaryBlockData } from "@/lib/agent/types";

const memberSinceFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatMemberSince(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : memberSinceFormat.format(date);
}

export function AccountSummaryBlock({ block }: { block: AccountSummaryBlockData }) {
  const { navigate } = useBlockActions();
  return (
    <section aria-label="Your account" className="rounded-card bg-surface p-4 text-caption">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{block.name}</span>
        <span className="rounded-sale bg-primary-tint px-2 py-0.5 text-[11px] font-semibold text-primary">
          {block.tier}
        </span>
      </div>
      <p className="text-text-secondary">{block.email}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <dt className="text-micro text-text-secondary">Points</dt>
          <dd className="text-title font-semibold">
            {Number(block.loyaltyPoints).toLocaleString("en-US")}
          </dd>
        </div>
        <div>
          <dt className="text-micro text-text-secondary">Member since</dt>
          <dd className="text-title font-semibold">{formatMemberSince(block.memberSince)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-micro text-text-secondary">Points redemption coming soon</p>
      <Link href="/account" onClick={navigate} className="btn-filled mt-3">
        View account
      </Link>
    </section>
  );
}
