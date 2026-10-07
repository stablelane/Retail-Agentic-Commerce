"use client";

import Link from "next/link";

import { formatOrderDateTime, orderHref } from "@/lib/commerce/orders";
import { useRecentOrders } from "@/lib/commerce/recent-orders";
import { formatCents } from "@/lib/money";

/** Orders placed from this browser (localStorage). */
export function RecentOrdersList() {
  const orders = useRecentOrders();

  return (
    <section aria-labelledby="recent-orders-heading" className="flex w-full flex-col gap-3">
      <h2 id="recent-orders-heading" className="text-title font-semibold">
        Recent orders
      </h2>
      {orders.length === 0 ? (
        <p className="text-small text-text-secondary">
          Orders you place on this device will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-card bg-surface px-4">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={orderHref(order.id, order.email)}
                className="flex flex-wrap items-center justify-between gap-2 py-3 hover:underline"
              >
                <span className="flex flex-col">
                  <span className="text-small font-semibold break-all">{order.id}</span>
                  <span className="text-micro text-text-secondary">
                    Placed {formatOrderDateTime(order.placedAt)}
                  </span>
                </span>
                {order.total !== null ? (
                  <span className="text-small font-semibold">{formatCents(order.total)}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
