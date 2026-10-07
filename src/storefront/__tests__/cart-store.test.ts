import {
  CART_STORAGE_KEY,
  MAX_LINE_QUANTITY,
  cartItemCount,
  cartSubtotal,
  createCartStore,
  type CartProduct,
} from "@/lib/commerce/cart-store";
import type { CheckoutSession } from "@/lib/commerce/acp";

const TEE: CartProduct = {
  id: "prod_1",
  name: "Classic Tee",
  price: 2500,
  imageUrl: "/prod_1.jpeg",
};
const JEANS: CartProduct = {
  id: "prod_2",
  name: "Slim Jeans",
  price: 6000,
  imageUrl: "/prod_2.jpeg",
};

/** Minimal Web Storage; newer Node versions shadow jsdom's `localStorage` global. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

let storage: MemoryStorage;

function persisted(): unknown {
  return JSON.parse(storage.getItem(CART_STORAGE_KEY) ?? "null");
}

function session(id: string): CheckoutSession {
  return {
    id,
    status: "not_ready_for_payment",
    currency: "usd",
    buyer: null,
    line_items: [],
    fulfillment_address: null,
    fulfillment_options: [],
    fulfillment_option_id: null,
    totals: [],
    messages: [],
  };
}

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("cart store", () => {
  it("starts empty and hydrated in the browser", () => {
    const store = createCartStore(storage);
    expect(store.getSnapshot()).toMatchObject({
      hydrated: true,
      items: [],
      sessionId: null,
      session: null,
      syncStatus: "idle",
    });
  });

  it("adds items and merges repeat adds into one line", () => {
    const store = createCartStore(storage);
    store.add(TEE);
    store.add(JEANS, 2);
    store.add(TEE, 3);

    const { items } = store.getSnapshot();
    expect(items.map((item) => [item.id, item.quantity])).toEqual([
      ["prod_1", 4],
      ["prod_2", 2],
    ]);
    expect(cartItemCount(items)).toBe(6);
    expect(cartSubtotal(items)).toBe(4 * 2500 + 2 * 6000);
  });

  it("caps quantities at the line maximum and the stock-derived maximum", () => {
    const store = createCartStore(storage);
    store.add(TEE, 50);
    expect(store.getSnapshot().items[0]?.quantity).toBe(MAX_LINE_QUANTITY);

    store.add(JEANS, 2, 3);
    store.add(JEANS, 5, 3);
    expect(store.getSnapshot().items[1]).toMatchObject({ quantity: 3, maxQuantity: 3 });

    store.setQuantity("prod_2", 99);
    expect(store.getSnapshot().items[1]?.quantity).toBe(3);
  });

  it("ignores invalid adds", () => {
    const store = createCartStore(storage);
    store.add({ ...TEE, id: "../admin" });
    store.add(TEE, 0);
    store.add(TEE, 1, 0);
    store.add(TEE, Number.NaN);
    expect(store.getSnapshot().items).toEqual([]);
  });

  it("updates quantity and removes the line at zero", () => {
    const store = createCartStore(storage);
    store.add(TEE, 2);
    store.add(JEANS);

    store.setQuantity("prod_1", 5);
    expect(store.getSnapshot().items[0]?.quantity).toBe(5);

    store.setQuantity("prod_1", 0);
    expect(store.getSnapshot().items.map((item) => item.id)).toEqual(["prod_2"]);

    store.setQuantity("prod_missing", 3);
    expect(store.getSnapshot().items).toHaveLength(1);
  });

  it("removes a line and clears the cart with its session", () => {
    const store = createCartStore(storage);
    store.add(TEE);
    store.add(JEANS);
    store.setSession(session("checkout_abc123"));
    store.setSyncStatus("synced");

    store.remove("prod_1");
    expect(store.getSnapshot().items.map((item) => item.id)).toEqual(["prod_2"]);

    store.clear();
    expect(store.getSnapshot()).toMatchObject({
      items: [],
      sessionId: null,
      session: null,
      syncStatus: "idle",
    });
    expect(persisted()).toEqual({ items: [], sessionId: null });
  });

  it("notifies subscribers only on changes and stops after unsubscribe", () => {
    const store = createCartStore(storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.add(TEE);
    store.remove("prod_missing");
    store.setSyncStatus("idle");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.add(JEANS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("persists items and session id to localStorage and restores them", () => {
    const store = createCartStore(storage);
    store.add(TEE, 2);
    store.setSession(session("checkout_abc123"));
    store.setSyncStatus("synced");

    expect(persisted()).toEqual({
      items: [{ ...TEE, quantity: 2, maxQuantity: MAX_LINE_QUANTITY }],
      sessionId: "checkout_abc123",
    });

    const restored = createCartStore(storage).getSnapshot();
    expect(restored.items).toEqual([{ ...TEE, quantity: 2, maxQuantity: MAX_LINE_QUANTITY }]);
    expect(restored.sessionId).toBe("checkout_abc123");
    // The full session and sync status are not persisted.
    expect(restored.session).toBeNull();
    expect(restored.syncStatus).toBe("idle");
  });

  it("recovers from corrupt JSON", () => {
    storage.setItem(CART_STORAGE_KEY, "{not json");
    const store = createCartStore(storage);
    expect(store.getSnapshot().items).toEqual([]);

    store.add(TEE);
    expect(persisted()).toMatchObject({ items: [{ id: "prod_1", quantity: 1 }] });
  });

  it("drops invalid persisted items and session ids", () => {
    const valid = { ...TEE, quantity: 2, maxQuantity: 5 };
    storage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        items: [
          valid,
          { ...valid, id: "prod_bad/../x" },
          { ...valid, id: "prod_3", quantity: 6 },
          { ...valid, id: "prod_4", quantity: 0 },
          { ...valid, id: "prod_5", price: -1 },
          { ...valid, id: "prod_6", maxQuantity: 99, quantity: 50 },
          { ...valid, id: "prod_7", name: 42 },
          null,
          "prod_8",
        ],
        sessionId: "javascript:alert(1)",
      })
    );

    const snapshot = createCartStore(storage).getSnapshot();
    expect(snapshot.items).toEqual([valid]);
    expect(snapshot.sessionId).toBeNull();
  });

  it("treats a non-array items field as empty", () => {
    storage.setItem(CART_STORAGE_KEY, JSON.stringify({ items: { 0: TEE } }));
    expect(createCartStore(storage).getSnapshot().items).toEqual([]);
  });

  it("keeps working in memory when storage is blocked", () => {
    const blocked: Storage = {
      length: 0,
      clear: vi.fn(),
      key: () => null,
      removeItem: vi.fn(),
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = createCartStore(blocked);
    store.add(TEE);
    expect(store.getSnapshot().items).toHaveLength(1);
  });

  it("works without storage (server render)", () => {
    const store = createCartStore(null);
    store.add(TEE);
    expect(store.getSnapshot().items).toHaveLength(1);
  });
});
