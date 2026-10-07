import type { Metadata } from "next";
import Link from "next/link";

import { RecentOrdersList } from "@/components/orders/RecentOrdersList";
import { LoyaltyCard } from "@/components/store/LoyaltyCard";
import { MOCK_USER } from "@/lib/commerce/user";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-content) pt-12">
        <h1 className="font-serif text-h2 leading-[1.1] font-normal">Your account</h1>
        <div className="mt-8">
          <LoyaltyCard user={MOCK_USER} />
        </div>
        <div className="mt-10 flex flex-col items-start gap-4">
          <RecentOrdersList />
          <Link href="/orders" className="btn-outline">
            Track another order
          </Link>
        </div>
      </div>
    </div>
  );
}
