import "server-only";

import { randomUUID } from "node:crypto";

import type { NotificationBlock } from "@/lib/agent/types";
import type { NotificationEvent } from "@/lib/notifications/types";

/**
 * In-memory pub/sub between the webhook receiver and SSE subscribers. The demo has a single
 * shopper, so every connected tab receives every notification.
 */
export interface NotificationEmitter {
  publish(block: NotificationBlock): NotificationEvent;
  /** Returns the unsubscribe function, or null when the subscriber cap is reached. */
  subscribe(listener: (event: NotificationEvent) => void): (() => void) | null;
  /** Buffered events after `cursor`; a cursor from an earlier process replays the whole buffer. */
  since(cursor: string | null): NotificationEvent[];
  /** Id of the latest event (`<bootId>-0` before any). */
  cursor(): string;
  subscriberCount(): number;
}

export interface NotificationEmitterOptions {
  bufferSize?: number;
  maxSubscribers?: number;
  bootId?: string;
}

const CURSOR_PATTERN = /^([a-z0-9]{1,16})-(\d{1,15})$/;

export function createNotificationEmitter({
  bufferSize = 20,
  maxSubscribers = 100,
  bootId = randomUUID().slice(0, 8),
}: NotificationEmitterOptions = {}): NotificationEmitter {
  const listeners = new Set<(event: NotificationEvent) => void>();
  const buffer: Array<{ seq: number; event: NotificationEvent }> = [];
  let seq = 0;

  return {
    publish(block) {
      seq += 1;
      const event: NotificationEvent = { id: `${bootId}-${seq}`, block };
      buffer.push({ seq, event });
      if (buffer.length > bufferSize) buffer.splice(0, buffer.length - bufferSize);
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // A broken subscriber must not block delivery to the others.
        }
      }
      return event;
    },
    subscribe(listener) {
      if (listeners.size >= maxSubscribers) return null;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    since(cursor) {
      const match = cursor ? CURSOR_PATTERN.exec(cursor) : null;
      if (!match) return [];
      const after = match[1] === bootId ? Number(match[2]) : 0;
      return buffer.filter((entry) => entry.seq > after).map((entry) => entry.event);
    },
    cursor: () => `${bootId}-${seq}`,
    subscriberCount: () => listeners.size,
  };
}

// Route handlers can be bundled separately, so the singleton lives on globalThis.
const GLOBAL_KEY = "__matterStorefrontNotifications";
type GlobalWithEmitter = typeof globalThis & { [GLOBAL_KEY]?: NotificationEmitter };

export function getNotificationEmitter(): NotificationEmitter {
  const scope = globalThis as GlobalWithEmitter;
  scope[GLOBAL_KEY] ??= createNotificationEmitter();
  return scope[GLOBAL_KEY];
}
