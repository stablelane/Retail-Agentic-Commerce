import type { Metadata } from "next";

import { OrderLookupForm } from "@/components/orders/OrderLookupForm";
import { RecentOrdersList } from "@/components/orders/RecentOrdersList";

export const metadata: Metadata = { title: "Track your order" };

export default function OrdersPage() {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto flex max-w-(--container-content) flex-col gap-10 pt-12">
        <div>
          <h1 className="font-serif text-h2 leading-[1.1] font-normal">Track your order</h1>
          <p className="mt-3 text-body text-text-secondary">
            Enter your order ID and the email used at checkout.
          </p>
        </div>
        <section aria-label="Order lookup" className="rounded-card bg-surface p-6">
          <OrderLookupForm />
        </section>
        <RecentOrdersList />
      </div>
    </div>
  );
}
