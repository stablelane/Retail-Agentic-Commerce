import {
  AcpRequestError,
  proxyRequest,
  sessionPath,
  type AcpItem,
  type CheckoutSession,
  type CheckoutSessionPatch,
  type FetchLike,
} from "@/lib/commerce/acp";
import { cartStore, type CartItem, type CartStore } from "@/lib/commerce/cart-store";
import { MOCK_BUYER, MOCK_USER_ADDRESS } from "@/lib/commerce/user";

export const DEFAULT_FULFILLMENT_OPTION_ID = "shipping_standard";
export const SYNC_DEBOUNCE_MS = 300;
export const SYNC_RETRY_MS = 5_000;

/** The stored session can no longer be updated (expired, completed or canceled). */
export function isStaleSessionError(error: unknown): boolean {
  return error instanceof AcpRequestError && (error.status === 404 || error.status === 405);
}

/** Network failures and upstream outages are worth retrying; validation errors are not. */
function isRetryable(error: unknown): boolean {
  return (
    !(error instanceof AcpRequestError) ||
    error.status === 0 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export function preferredFulfillmentOptionId(
  session: CheckoutSession,
  preferred?: string | null
): string | null {
  const ids = session.fulfillment_options.map((option) => option.id);
  if (preferred && ids.includes(preferred)) return preferred;
  if (session.fulfillment_option_id && ids.includes(session.fulfillment_option_id)) {
    return session.fulfillment_option_id;
  }
  if (ids.includes(DEFAULT_FULFILLMENT_OPTION_ID)) return DEFAULT_FULFILLMENT_OPTION_ID;
  return ids[0] ?? null;
}

export function appliedDiscountCodes(session: CheckoutSession | null): string[] {
  return (session?.discounts?.applied ?? [])
    .map((discount) => discount.code)
    .filter((code): code is string => typeof code === "string" && code.length > 0);
}

function updateSession(
  sessionId: string,
  patch: CheckoutSessionPatch,
  fetchImpl: FetchLike | undefined
): Promise<CheckoutSession> {
  return proxyRequest<CheckoutSession>("merchant", sessionPath(sessionId), {
    method: "POST",
    body: patch,
    fetchImpl,
  });
}

async function ensureFulfillmentSelection(
  session: CheckoutSession,
  preferred: string | null | undefined,
  fetchImpl: FetchLike | undefined
): Promise<CheckoutSession> {
  const target = preferredFulfillmentOptionId(session, preferred);
  if (!target || target === session.fulfillment_option_id) return session;
  return updateSession(session.id, { fulfillment_option_id: target }, fetchImpl);
}

interface SyncCheckoutSessionParams {
  items: readonly CartItem[];
  sessionId: string | null;
  /** Last known session, used to carry shipping choice and codes into a recreated session. */
  previous?: CheckoutSession | null;
  fetchImpl?: FetchLike | undefined;
}

/**
 * Mirror the cart into a single ACP checkout session: update the stored session, or create
 * a fresh one when there is none or it has gone stale, then make sure a fulfillment option is
 * selected. An empty cart cancels the session and resolves to null.
 */
export async function syncCheckoutSession({
  items,
  sessionId,
  previous = null,
  fetchImpl,
}: SyncCheckoutSessionParams): Promise<CheckoutSession | null> {
  if (items.length === 0) {
    if (sessionId) {
      await proxyRequest("merchant", sessionPath(sessionId, "cancel"), {
        method: "POST",
        fetchImpl,
      }).catch(() => undefined);
    }
    return null;
  }

  const acpItems: AcpItem[] = items.map(({ id, quantity }) => ({ id, quantity }));
  const preferred = previous?.fulfillment_option_id ?? null;

  if (sessionId) {
    try {
      const updated = await updateSession(sessionId, { items: acpItems }, fetchImpl);
      if (updated.status !== "completed" && updated.status !== "canceled") {
        return await ensureFulfillmentSelection(updated, preferred, fetchImpl);
      }
    } catch (error) {
      if (!isStaleSessionError(error)) throw error;
    }
  }

  const codes = appliedDiscountCodes(previous);
  const created = await proxyRequest<CheckoutSession>("merchant", "/checkout_sessions", {
    method: "POST",
    body: {
      items: acpItems,
      buyer: MOCK_BUYER,
      fulfillment_address: MOCK_USER_ADDRESS,
      ...(codes.length > 0 ? { discounts: { codes } } : {}),
    },
    fetchImpl,
  });
  return ensureFulfillmentSelection(created, preferred, fetchImpl);
}

export interface SessionSyncer {
  /** Subscribe to cart changes (debounced) and sync once; returns a stop function. */
  start(): () => void;
  /** Sync now, skipping the network when the session already mirrors the cart. */
  flush(): Promise<CheckoutSession | null>;
  /** Apply a session patch (discount codes, shipping option, buyer…) after syncing items. */
  updateSession(patch: CheckoutSessionPatch): Promise<CheckoutSession>;
  /** Run a task with an up-to-date session while blocking other syncs (used by checkout). */
  withSyncedSession<T>(task: (session: CheckoutSession) => Promise<T>): Promise<T>;
}

export interface SessionSyncerOptions {
  debounceMs?: number;
  retryMs?: number;
  fetchImpl?: FetchLike;
}

function itemsKey(items: readonly CartItem[]): string {
  return JSON.stringify(items.map((item) => [item.id, item.quantity]));
}

const EMPTY_CART_MESSAGE = "Your bag is empty.";

export function createSessionSyncer(
  store: CartStore,
  { debounceMs = SYNC_DEBOUNCE_MS, retryMs = SYNC_RETRY_MS, fetchImpl }: SessionSyncerOptions = {}
): SessionSyncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let synced: { key: string; sessionId: string | null } | null = null;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  function schedule(delay: number) {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      flush().catch(() => undefined);
    }, delay);
  }

  async function syncNow(
    fallbackPrevious: CheckoutSession | null = null
  ): Promise<CheckoutSession | null> {
    const { items, sessionId, session } = store.getSnapshot();
    const key = itemsKey(items);
    const upToDate =
      synced !== null &&
      synced.key === key &&
      synced.sessionId === sessionId &&
      (sessionId === null || session !== null);
    if (upToDate) return session;

    store.setSyncStatus("syncing");
    try {
      const next = await syncCheckoutSession({
        items,
        sessionId,
        previous: session ?? fallbackPrevious,
        fetchImpl,
      });
      store.setSession(next);
      synced = { key, sessionId: next?.id ?? null };
      store.setSyncStatus(next ? "synced" : "idle");
      return next;
    } catch (error) {
      synced = null;
      if (isRetryable(error)) {
        store.setSyncStatus("offline");
        schedule(retryMs);
      } else {
        store.setSyncStatus("error");
      }
      throw error;
    }
  }

  function flush(): Promise<CheckoutSession | null> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    return enqueue(() => syncNow());
  }

  async function requireSession(
    fallbackPrevious: CheckoutSession | null = null
  ): Promise<CheckoutSession> {
    const session = await syncNow(fallbackPrevious);
    if (!session) throw new Error(EMPTY_CART_MESSAGE);
    return session;
  }

  function adopt(session: CheckoutSession) {
    store.setSession(session);
    synced = { key: itemsKey(store.getSnapshot().items), sessionId: session.id };
    store.setSyncStatus("synced");
  }

  return {
    start() {
      let lastKey = itemsKey(store.getSnapshot().items);
      const unsubscribe = store.subscribe(() => {
        const key = itemsKey(store.getSnapshot().items);
        if (key === lastKey) return;
        lastKey = key;
        schedule(debounceMs);
      });
      const { items, sessionId } = store.getSnapshot();
      if (items.length > 0 || sessionId) flush().catch(() => undefined);
      return () => {
        unsubscribe();
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      };
    },
    flush,
    updateSession(patch) {
      return enqueue(async () => {
        const session = await requireSession();
        store.setSyncStatus("syncing");
        try {
          const next = await updateSession(session.id, patch, fetchImpl);
          adopt(next);
          return next;
        } catch (error) {
          if (!isStaleSessionError(error)) {
            store.setSyncStatus("synced");
            throw error;
          }
          store.setSession(null);
          synced = null;
          // Keep shipping choice and codes when recreating the session.
          const fresh = await requireSession(session);
          const next = await updateSession(fresh.id, patch, fetchImpl);
          adopt(next);
          return next;
        }
      });
    },
    withSyncedSession(task) {
      return enqueue(async () => task(await requireSession()));
    },
  };
}

let browserSyncer: SessionSyncer | null = null;

/** Shared syncer bound to the browser cart store. */
export function getSessionSyncer(): SessionSyncer {
  browserSyncer ??= createSessionSyncer(cartStore);
  return browserSyncer;
}
