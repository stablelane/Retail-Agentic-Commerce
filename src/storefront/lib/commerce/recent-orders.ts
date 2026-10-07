import { useSyncExternalStore } from "react";

import { isEmail, isOrderId } from "@/lib/commerce/orders";

export const RECENT_ORDERS_KEY = "matter.orders.v1";
const MAX_RECENT_ORDERS = 10;

export interface RecentOrder {
  id: string;
  email: string;
  placedAt: string;
  total: number | null;
}

function isRecentOrder(value: unknown): value is RecentOrder {
  if (typeof value !== "object" || value === null) return false;
  const order = value as Record<string, unknown>;
  return (
    typeof order.id === "string" &&
    isOrderId(order.id) &&
    typeof order.email === "string" &&
    isEmail(order.email) &&
    typeof order.placedAt === "string" &&
    (order.total === null || Number.isInteger(order.total))
  );
}

export function parseRecentOrders(raw: string | null): RecentOrder[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentOrder).slice(0, MAX_RECENT_ORDERS) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedOrders: RecentOrder[] = [];
const NO_ORDERS: RecentOrder[] = [];

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(RECENT_ORDERS_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): RecentOrder[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedOrders = parseRecentOrders(raw);
  }
  return cachedOrders;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function saveRecentOrder(order: RecentOrder): void {
  const orders = [order, ...getSnapshot().filter((existing) => existing.id !== order.id)].slice(
    0,
    MAX_RECENT_ORDERS
  );
  try {
    window.localStorage.setItem(RECENT_ORDERS_KEY, JSON.stringify(orders));
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

export function useRecentOrders(): RecentOrder[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => NO_ORDERS);
}
