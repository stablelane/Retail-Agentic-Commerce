import type { Product } from "@/lib/commerce/merchant";

/** The catalog has no end times; assume a show runs this long. */
export const EVENT_MINUTES = 180;
export const SAME_VENUE_GAP_MINUTES = 30;
export const TRAVEL_GAP_MINUTES = 60;
export const MAX_PLAN_DAYS = 14;
export const MAX_EVENTS_PER_DAY = 4;

const MINUTE = 60_000;

export interface PlannedEvent {
  product: Product;
  sessionId: string;
  startsAt: string;
  start: number;
  end: number;
}

export interface ItineraryPlan {
  days: Array<{ date: string; events: PlannedEvent[] }>;
  freeDays: string[];
}

export interface PlanOptions {
  dateFrom: string;
  dateTo: string;
  partySize: number;
  maxPerDay: number;
  categories?: readonly string[];
}

/** Inclusive list of ISO dates; empty when the range is reversed. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 1440 * MINUTE) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function gapMinutes(previous: PlannedEvent, next: PlannedEvent): number {
  const venue = previous.product.venue;
  return venue && venue === next.product.venue ? SAME_VENUE_GAP_MINUTES : TRAVEL_GAP_MINUTES;
}

/**
 * Fit as many distinct events as possible into the trip: each show once, enough seats for the
 * party, and time to travel between venues. Scarce days are filled first so events that run on
 * several days do not crowd out a day with a single option.
 */
export function planItinerary(products: Iterable<Product>, options: PlanOptions): ItineraryPlan {
  const days = eachDay(options.dateFrom, options.dateTo);
  const inRange = new Set(days);
  const byDay = new Map<string, PlannedEvent[]>(days.map((day) => [day, []]));

  for (const product of products) {
    if (options.categories?.length && !options.categories.includes(product.category ?? "")) {
      continue;
    }
    for (const session of product.sessions ?? []) {
      const day = session.starts_at.slice(0, 10);
      const start = Date.parse(session.starts_at);
      if (!inRange.has(day) || session.seats_left < options.partySize || Number.isNaN(start)) {
        continue;
      }
      byDay.get(day)?.push({
        product,
        sessionId: session.id,
        startsAt: session.starts_at,
        start,
        end: start + EVENT_MINUTES * MINUTE,
      });
    }
  }

  const used = new Set<string>();
  const chosen = new Map<string, PlannedEvent[]>();
  const scarceFirst = [...byDay.entries()].sort(
    ([, a], [, b]) =>
      new Set(a.map((e) => e.product.id)).size - new Set(b.map((e) => e.product.id)).size
  );
  for (const [day, candidates] of scarceFirst) {
    const picked: PlannedEvent[] = [];
    for (const candidate of [...candidates].sort((a, b) => a.end - b.end)) {
      if (picked.length >= options.maxPerDay) break;
      if (used.has(candidate.product.id)) continue;
      const last = picked[picked.length - 1];
      if (last && candidate.start < last.end + gapMinutes(last, candidate) * MINUTE) continue;
      picked.push(candidate);
      used.add(candidate.product.id);
    }
    chosen.set(day, picked);
  }

  return {
    days: days
      .map((date) => ({ date, events: chosen.get(date) ?? [] }))
      .filter((day) => day.events.length > 0),
    freeDays: days.filter((date) => (chosen.get(date)?.length ?? 0) === 0),
  };
}
