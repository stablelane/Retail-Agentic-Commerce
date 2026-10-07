import type { CartUpdateItem } from "@/lib/agent/types";
import { cartStore, type CartStore } from "@/lib/commerce/cart-store";

/** Replace the browser cart with the server's `cart_update` items; the session syncer follows. */
export function applyCartUpdate(
  items: readonly CartUpdateItem[],
  store: CartStore = cartStore
): void {
  const next = new Map(items.map((item) => [item.id, item]));
  for (const current of store.getSnapshot().items) {
    if (!next.has(current.id)) store.remove(current.id);
  }
  for (const item of next.values()) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) continue;
    const product = { id: item.id, name: item.name, price: item.price, imageUrl: item.imageUrl };
    const existing = store.getSnapshot().items.find((line) => line.id === item.id);
    if (!existing) {
      store.add(product, item.quantity, item.maxQuantity);
      continue;
    }
    const unchanged =
      existing.quantity === item.quantity &&
      existing.price === item.price &&
      existing.maxQuantity === item.maxQuantity;
    // A signed delta through `add` also refreshes price, name and max quantity.
    if (!unchanged) store.add(product, item.quantity - existing.quantity, item.maxQuantity);
  }
}
