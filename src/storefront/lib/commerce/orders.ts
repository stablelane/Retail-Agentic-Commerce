import type { ShippingStatus } from "@/lib/commerce/merchant";
import { ORDER_ID } from "@/lib/commerce/proxy-allowlist";

export const SHIPPING_STEPS: ReadonlyArray<{ status: ShippingStatus; label: string }> = [
  { status: "order_confirmed", label: "Order confirmed" },
  { status: "order_shipped", label: "Shipped" },
  { status: "out_for_delivery", label: "Out for delivery" },
  { status: "delivered", label: "Delivered" },
];

const MAX_EMAIL_LENGTH = 256;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isOrderId(value: string): boolean {
  return ORDER_ID.test(value);
}

export function isEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export function orderHref(orderId: string, email: string, placed = false): string {
  const query = new URLSearchParams({ email });
  if (placed) query.set("placed", "1");
  return `/orders/${encodeURIComponent(orderId)}?${query.toString()}`;
}

/** Only http(s) links are rendered; anything else (e.g. `javascript:`) is dropped. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function formatWith(format: Intl.DateTimeFormat, value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format.format(date);
}

export function formatOrderDateTime(value: string): string {
  return formatWith(dateTimeFormat, value);
}

export function formatOrderDate(value: string): string {
  return formatWith(dateFormat, value);
}
