/** Notifications SSE contract shared by the stream route and the browser hook (feature 18, §4.6). */

import type { NotificationBlock } from "@/lib/agent/types";

/** Frame carrying a `NotificationBlock` as its data. */
export const NOTIFICATION_EVENT = "notification";
/** Sent once per connection after any replay; its SSE id is the current cursor. */
export const READY_EVENT = "ready";

export interface NotificationEvent {
  /** `<bootId>-<seq>`; also the SSE `id:` used for Last-Event-ID replay. */
  id: string;
  block: NotificationBlock;
}
