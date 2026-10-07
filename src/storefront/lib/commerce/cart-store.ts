import { useSyncExternalStore } from "react";

import type { CheckoutSession } from "@/lib/commerce/acp";
import { CHECKOUT_SESSION_ID, PRODUCT_ID } from "@/lib/commerce/proxy-allowlist";

export const CART_STORAGE_KEY = "matter.cart.v1";
export const MAX_LINE_QUANTITY = 10;

export interface CartItem {
  id: string;
  name: string;
  /** Unit price in cents at the time the item was added. */
  price: number;
  imageUrl: string;
  quantity: number;
  maxQuantity: number;
}

export type CartProduct = Omit<CartItem, "quantity" | "maxQuantity">;

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

export interface CartSnapshot {
  /** False until the browser copy has been read (always false during SSR). */
  hydrated: boolean;
  items: readonly CartItem[];
  sessionId: string | null;
  /** Latest ACP session response; not persisted, refreshed on load. */
  session: CheckoutSession | null;
  syncStatus: SyncStatus;
}

export interface CartStore {
  getSnapshot(): CartSnapshot;
  subscribe(listener: () => void): () => void;
  add(product: CartProduct, quantity?: number, maxQuantity?: number): void;
  setQuantity(productId: string, quantity: number): void;
  remove(productId: string): void;
  clear(): void;
  setSession(session: CheckoutSession | null): void;
  setSyncStatus(status: SyncStatus): void;
}

const SERVER_SNAPSHOT: CartSnapshot = {
  hydrated: false,
  items: [],
  sessionId: null,
  session: null,
  syncStatus: "idle",
};

function clampQuantity(quantity: number, max: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.min(Math.trunc(quantity), max));
}

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    PRODUCT_ID.test(item.id) &&
    typeof item.name === "string" &&
    typeof item.imageUrl === "string" &&
    Number.isInteger(item.price) &&
    (item.price as number) >= 0 &&
    Number.isInteger(item.maxQuantity) &&
    (item.maxQuantity as number) >= 1 &&
    (item.maxQuantity as number) <= MAX_LINE_QUANTITY &&
    Number.isInteger(item.quantity) &&
    (item.quantity as number) >= 1 &&
    (item.quantity as number) <= (item.maxQuantity as number)
  );
}

function readPersisted(storage: Storage | null): Pick<CartSnapshot, "items" | "sessionId"> {
  try {
    const raw = storage?.getItem(CART_STORAGE_KEY);
    if (!raw) return { items: [], sessionId: null };
    const parsed = JSON.parse(raw) as { items?: unknown; sessionId?: unknown };
    const items = Array.isArray(parsed.items) ? parsed.items.filter(isCartItem) : [];
    const sessionId =
      typeof parsed.sessionId === "string" && CHECKOUT_SESSION_ID.test(parsed.sessionId)
        ? parsed.sessionId
        : null;
    return { items, sessionId };
  } catch {
    return { items: [], sessionId: null };
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createCartStore(storage: Storage | null = browserStorage()): CartStore {
  let state: CartSnapshot = SERVER_SNAPSHOT;
  let loaded = false;
  const listeners = new Set<() => void>();

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    state = { ...state, ...readPersisted(storage), hydrated: true };
  }

  function update(next: Partial<CartSnapshot>, persist: boolean) {
    ensureLoaded();
    state = { ...state, ...next };
    if (persist) {
      try {
        storage?.setItem(
          CART_STORAGE_KEY,
          JSON.stringify({ items: state.items, sessionId: state.sessionId })
        );
      } catch {
        // Storage full or blocked; the in-memory cart still works.
      }
    }
    listeners.forEach((listener) => listener());
  }

  function setItems(items: readonly CartItem[]) {
    update({ items }, true);
  }

  return {
    getSnapshot() {
      ensureLoaded();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(product, quantity = 1, maxQuantity = MAX_LINE_QUANTITY) {
      ensureLoaded();
      const max = clampQuantity(maxQuantity, MAX_LINE_QUANTITY);
      if (max < 1 || !PRODUCT_ID.test(product.id)) return;
      const existing = state.items.find((item) => item.id === product.id);
      if (existing) {
        const nextQuantity = clampQuantity(existing.quantity + quantity, max);
        setItems(
          state.items.map((item) =>
            item.id === product.id
              ? { ...item, ...product, quantity: Math.max(1, nextQuantity), maxQuantity: max }
              : item
          )
        );
        return;
      }
      const initial = clampQuantity(quantity, max);
      if (initial < 1) return;
      setItems([...state.items, { ...product, quantity: initial, maxQuantity: max }]);
    },
    setQuantity(productId, quantity) {
      ensureLoaded();
      const item = state.items.find((candidate) => candidate.id === productId);
      if (!item) return;
      const next = clampQuantity(quantity, item.maxQuantity);
      if (next === item.quantity) return;
      setItems(
        next === 0
          ? state.items.filter((candidate) => candidate.id !== productId)
          : state.items.map((candidate) =>
              candidate.id === productId ? { ...candidate, quantity: next } : candidate
            )
      );
    },
    remove(productId) {
      ensureLoaded();
      if (!state.items.some((item) => item.id === productId)) return;
      setItems(state.items.filter((item) => item.id !== productId));
    },
    clear() {
      update({ items: [], sessionId: null, session: null, syncStatus: "idle" }, true);
    },
    setSession(session) {
      update({ session, sessionId: session?.id ?? null }, true);
    },
    setSyncStatus(syncStatus) {
      ensureLoaded();
      if (state.syncStatus !== syncStatus) update({ syncStatus }, false);
    },
  };
}

export const cartStore: CartStore = createCartStore();

export function useCart(): CartSnapshot {
  return useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot, () => SERVER_SNAPSHOT);
}

export function cartItemCount(items: readonly CartItem[]): number {
  return items.reduce((count, item) => count + item.quantity, 0);
}

export function cartSubtotal(items: readonly CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
