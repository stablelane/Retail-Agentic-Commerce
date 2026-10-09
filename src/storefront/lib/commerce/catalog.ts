import { PRODUCT_ID } from "@/lib/commerce/proxy-allowlist";

export const CATEGORIES = [
  { id: "live-entertainment", label: "Live entertainment" },
  { id: "family", label: "Family" },
  { id: "sports", label: "Sports" },
  { id: "attractions", label: "Attractions" },
  { id: "tours", label: "Tours" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

const FALLBACK_IMAGE = "/hero.jpg";
const LOCAL_IMAGE_PATTERN = /^\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|avif)$/;
const SESSION_DATE = /_(\d{4}-\d{2}-\d{2})(?:T|$)/;

export const EVENT_WINDOW = { min: "2026-10-01", max: "2026-12-31" } as const;

export function isCategory(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export function isProductId(value: string): boolean {
  return PRODUCT_ID.test(value);
}

/** Calendar day embedded in a session id, or null for a plain product id. */
export function sessionDate(id: string): string | null {
  return SESSION_DATE.exec(id)?.[1] ?? null;
}

export function nextSession<T extends { starts_at: string }>(
  sessions: readonly T[] | null | undefined
): T | null {
  if (!sessions || sessions.length === 0) return null;
  return [...sessions].sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
}

/** "Sat 12 Oct" or "Sat 12 Oct, 20:00" in Asia/Dubai. */
export function formatSessionWhen(value: string, withTime = false): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00+04:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Dubai",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const day = `${get("weekday")} ${get("day")} ${get("month")}`;
  return withTime ? `${day}, ${get("hour")}:${get("minute")}` : day;
}

/** Product images are served from this app's public/ folder; anything else falls back. */
export function productImageSrc(imageUrl: string | null | undefined): string {
  return imageUrl && LOCAL_IMAGE_PATTERN.test(imageUrl) ? imageUrl : FALLBACK_IMAGE;
}
