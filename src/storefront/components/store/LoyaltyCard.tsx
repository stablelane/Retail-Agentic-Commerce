import { LogOut } from "lucide-react";

import type { MockUser } from "@/lib/commerce/user";

const memberSinceFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function LoyaltyCard({ user }: { user: MockUser }) {
  const memberSince = memberSinceFormat.format(new Date(`${user.memberSince}T00:00:00Z`));

  return (
    <section aria-labelledby="loyalty-heading" className="rounded-card bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-caption text-text-secondary">Signed in as</p>
          <h2 id="loyalty-heading" className="mt-1 text-title font-semibold">
            {user.name}
          </h2>
          <p className="text-small text-text-secondary">{user.email}</p>
        </div>
        <span className="rounded-pill bg-primary-soft px-3 py-1 text-caption font-semibold text-primary">
          {user.tier} member
        </span>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-caption text-text-secondary">Points</dt>
          <dd className="mt-1 font-serif text-h2 leading-none">
            {user.loyaltyPoints.toLocaleString("en-US")}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">Member since</dt>
          <dd className="mt-1 font-serif text-h2 leading-none">{memberSince}</dd>
        </div>
      </dl>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <p className="text-small text-text-secondary">Points redemption coming soon</p>
        <button type="button" className="btn-outline gap-2" title="Demo account">
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </section>
  );
}
