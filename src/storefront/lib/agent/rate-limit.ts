import "server-only";

export interface RateLimiter {
  /** Returns false when `key` has exceeded the limit in the current window. */
  take(key: string, now?: number): boolean;
}

const MAX_TRACKED_KEYS = 10_000;

/** Fixed-window, in-memory limiter (single instance demo; not shared across replicas). */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  return {
    take(key, now = Date.now()) {
      const entry = windows.get(key);
      if (!entry || now - entry.start >= windowMs) {
        if (windows.size >= MAX_TRACKED_KEYS) {
          for (const [candidate, value] of windows) {
            if (now - value.start >= windowMs) windows.delete(candidate);
          }
          if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
        }
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
  };
}

/** Best-effort client key; proxy headers are trusted only for this demo limiter. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}
