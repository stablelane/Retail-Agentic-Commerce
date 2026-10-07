import type { Metadata } from "next";
import Link from "next/link";

import { OpenChatButton } from "@/components/chat/OpenChatButton";
import { OrderLookupForm } from "@/components/orders/OrderLookupForm";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { TotalsBlock } from "@/components/store/TotalsBlock";
import { getOrder, type Address, type OrderStatusResponse } from "@/lib/commerce/merchant";
import {
  SHIPPING_STEPS,
  formatOrderDate,
  formatOrderDateTime,
  isEmail,
  isOrderId,
  orderHref,
  safeHttpUrl,
} from "@/lib/commerce/orders";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Order status" };

interface OrderPageProps {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type OrderLookup =
  { kind: "found"; order: OrderStatusResponse } | { kind: "not_found" } | { kind: "unavailable" };

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

async function lookupOrder(orderId: string, email: string): Promise<OrderLookup> {
  try {
    const order = await getOrder(orderId, email);
    return order ? { kind: "found", order } : { kind: "not_found" };
  } catch {
    return { kind: "unavailable" };
  }
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto flex max-w-(--container-content) flex-col gap-8 pt-12">
        {children}
      </div>
    </div>
  );
}

function MessageState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <PageShell>
      <div>
        <h1 className="font-serif text-h2 leading-[1.1] font-normal">{title}</h1>
        <p className="mt-3 text-body text-text-secondary">{body}</p>
      </div>
      <div className="flex flex-wrap gap-3">{children}</div>
    </PageShell>
  );
}

function AddressLines({ address }: { address: Address }) {
  return (
    <address className="text-small leading-relaxed not-italic">
      {address.name}
      <br />
      {address.line_one}
      {address.line_two ? (
        <>
          <br />
          {address.line_two}
        </>
      ) : null}
      <br />
      {address.city}, {address.state} {address.postal_code}
      <br />
      {address.country}
    </address>
  );
}

function OrderDetails({ order, placed }: { order: OrderStatusResponse; placed: boolean }) {
  const currentLabel =
    SHIPPING_STEPS.find((step) => step.status === order.status)?.label ?? "Processing";
  const trackingUrl = safeHttpUrl(order.tracking_url);
  const carrier = [order.fulfillment?.title, order.fulfillment?.carrier_info]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageShell>
      {placed ? (
        <p role="status" className="rounded-card bg-primary-soft/40 p-4 text-small text-primary">
          <span className="font-semibold">Thank you for your order.</span> We&rsquo;ll send updates
          to {order.buyer.email}.
        </p>
      ) : null}

      <header>
        <p className="text-caption text-text-secondary">Order</p>
        <h1 className="mt-1 font-serif text-h2 leading-[1.1] font-normal break-all">{order.id}</h1>
        <p className="mt-2 text-small text-text-secondary">
          Placed <time dateTime={order.placed_at}>{formatOrderDateTime(order.placed_at)}</time>
        </p>
      </header>

      <section aria-labelledby="order-status-heading" className="rounded-card bg-surface p-6">
        <h2 id="order-status-heading" className="text-title font-semibold">
          {currentLabel}
        </h2>
        <OrderTimeline status={order.status} history={order.status_history} className="mt-5" />
        <dl className="mt-6 grid gap-4 text-small sm:grid-cols-3">
          <div>
            <dt className="text-caption text-text-secondary">Estimated delivery</dt>
            <dd className="mt-1 font-semibold">
              {order.estimated_delivery ? formatOrderDate(order.estimated_delivery) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">Carrier</dt>
            <dd className="mt-1 font-semibold">{carrier || "—"}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">Tracking</dt>
            <dd className="mt-1 font-semibold">
              {trackingUrl ? (
                <a
                  href={trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  Track package<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="order-items-heading">
        <h2 id="order-items-heading" className="text-title font-semibold">
          Items
        </h2>
        <ul className="mt-3 divide-y divide-line">
          {order.line_items.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-4 py-3 text-small">
              <span className="flex flex-col">
                <Link
                  href={`/products/${encodeURIComponent(line.item.id)}`}
                  className="font-semibold hover:underline"
                >
                  {line.name ?? line.item.id}
                </Link>
                <span className="text-micro text-text-secondary">Qty {line.item.quantity}</span>
              </span>
              <span className="font-semibold">{formatCents(line.subtotal)}</span>
            </li>
          ))}
        </ul>
        <TotalsBlock totals={order.totals} className="mt-4 rounded-card bg-surface p-6" />
      </section>

      {order.fulfillment_address ? (
        <section aria-labelledby="order-address-heading">
          <h2 id="order-address-heading" className="text-title font-semibold">
            Shipping to
          </h2>
          <div className="mt-3">
            <AddressLines address={order.fulfillment_address} />
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <OpenChatButton label="Ask about this order" prompt={`Where is order ${order.id}?`} />
        <Link href="/orders" className="btn-primary">
          Track another order
        </Link>
      </div>
    </PageShell>
  );
}

export default async function OrderPage({ params, searchParams }: OrderPageProps) {
  const { orderId } = await params;
  const query = await searchParams;
  const email = firstParam(query.email);

  if (!isOrderId(orderId)) {
    return (
      <MessageState
        title="We couldn’t find that order"
        body="Check the order ID and the email used at checkout, then try again."
      >
        <Link href="/orders" className="btn-pill">
          Back to order lookup
        </Link>
      </MessageState>
    );
  }

  if (!isEmail(email)) {
    return (
      <PageShell>
        <div>
          <h1 className="font-serif text-h2 leading-[1.1] font-normal">Track your order</h1>
          <p className="mt-3 text-body text-text-secondary">
            Enter the email used at checkout to view this order.
          </p>
        </div>
        <section aria-label="Order lookup" className="rounded-card bg-surface p-6">
          <OrderLookupForm defaultOrderId={orderId} />
        </section>
      </PageShell>
    );
  }

  const result = await lookupOrder(orderId, email);

  if (result.kind === "unavailable") {
    return (
      <MessageState
        title="We couldn’t load your order"
        body="The store is having trouble right now. Please try again in a moment."
      >
        <Link href={orderHref(orderId, email)} className="btn-pill">
          Try again
        </Link>
        <Link href="/orders" className="btn-primary">
          Back to order lookup
        </Link>
      </MessageState>
    );
  }

  if (result.kind === "not_found") {
    return (
      <MessageState
        title="We couldn’t find that order"
        body="Check the order ID and the email used at checkout, then try again."
      >
        <Link href="/orders" className="btn-pill">
          Back to order lookup
        </Link>
      </MessageState>
    );
  }

  return <OrderDetails order={result.order} placed={firstParam(query.placed) === "1"} />;
}
