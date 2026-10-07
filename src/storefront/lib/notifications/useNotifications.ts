"use client";

import { useEffect, useRef } from "react";

import type { NotificationBlock } from "@/lib/agent/types";
import { NOTIFICATION_EVENT, READY_EVENT } from "@/lib/notifications/types";

export const NOTIFICATIONS_STREAM_URL = "/api/notifications/stream";
export const NOTIFICATIONS_STORAGE_KEY = "matter.notifications.v1";

const MAX_SEEN_IDS = 50;
const MAX_ID_LENGTH = 64;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const EVENT_SOURCE_CLOSED = 2;

interface StoredCursor {
  cursor: string | null;
  seen: string[];
}

function storageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isEventId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function loadCursor(): StoredCursor {
  try {
    const parsed: unknown = JSON.parse(
      storageOrNull()?.getItem(NOTIFICATIONS_STORAGE_KEY) ?? "null"
    );
    if (typeof parsed === "object" && parsed !== null) {
      const { cursor, seen } = parsed as Record<string, unknown>;
      return {
        cursor: isEventId(cursor) ? cursor : null,
        seen: Array.isArray(seen) ? seen.filter(isEventId).slice(-MAX_SEEN_IDS) : [],
      };
    }
  } catch {
    // Corrupt entry; start fresh.
  }
  return { cursor: null, seen: [] };
}

function saveCursor(state: StoredCursor): void {
  try {
    storageOrNull()?.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked; dedupe still works for this page.
  }
}

/** Validates a `notification` frame's data; anything malformed is dropped. */
export function parseNotification(data: unknown): NotificationBlock | null {
  let value: unknown;
  try {
    value = typeof data === "string" ? JSON.parse(data) : null;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const block = value as Record<string, unknown>;
  const trackingUrl = block.trackingUrl ?? null;
  if (
    block.type !== "notification" ||
    typeof block.subject !== "string" ||
    typeof block.message !== "string" ||
    typeof block.status !== "string" ||
    typeof block.orderId !== "string" ||
    typeof block.receivedAt !== "string" ||
    (trackingUrl !== null && typeof trackingUrl !== "string")
  ) {
    return null;
  }
  return {
    type: "notification",
    subject: block.subject,
    message: block.message,
    status: block.status,
    orderId: block.orderId,
    trackingUrl,
    receivedAt: block.receivedAt,
  };
}

export interface UseNotificationsOptions {
  url?: string;
  /** Test seam; defaults to the browser `EventSource`. */
  createEventSource?: (url: string) => EventSource;
}

/**
 * Subscribes to `/api/notifications/stream`, deduping by event id and resuming from the last
 * seen cursor (kept in sessionStorage) after reloads and reconnects.
 */
export function useNotifications(
  onNotification: (block: NotificationBlock) => void,
  { url = NOTIFICATIONS_STREAM_URL, createEventSource }: UseNotificationsOptions = {}
): void {
  const callbackRef = useRef(onNotification);
  const factoryRef = useRef(createEventSource);

  useEffect(() => {
    callbackRef.current = onNotification;
    factoryRef.current = createEventSource;
  }, [onNotification, createEventSource]);

  useEffect(() => {
    const factory =
      factoryRef.current ??
      (typeof EventSource === "undefined" ? null : (target: string) => new EventSource(target));
    if (!factory) return;

    const state = loadCursor();
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;

    const onReady = (event: Event) => {
      const { lastEventId } = event as MessageEvent;
      if (!isEventId(lastEventId) || lastEventId === state.cursor) return;
      state.cursor = lastEventId;
      saveCursor(state);
    };

    const onNotificationFrame = (event: Event) => {
      const { data, lastEventId } = event as MessageEvent;
      if (!isEventId(lastEventId) || state.seen.includes(lastEventId)) return;
      state.seen = [...state.seen, lastEventId].slice(-MAX_SEEN_IDS);
      state.cursor = lastEventId;
      saveCursor(state);
      const block = parseNotification(data);
      if (block) callbackRef.current(block);
    };

    const connect = () => {
      if (disposed) return;
      const target = state.cursor
        ? `${url}?${new URLSearchParams({ lastEventId: state.cursor }).toString()}`
        : url;
      const next = factory(target);
      source = next;
      next.addEventListener("open", () => {
        attempts = 0;
      });
      next.addEventListener(READY_EVENT, onReady);
      next.addEventListener(NOTIFICATION_EVENT, onNotificationFrame);
      next.addEventListener("error", () => {
        // The browser retries dropped connections itself; a closed source needs a new one.
        if (disposed || next.readyState !== EVENT_SOURCE_CLOSED) return;
        next.close();
        if (source === next) source = null;
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempts);
        attempts += 1;
        timer = setTimeout(connect, delay);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, [url]);
}
