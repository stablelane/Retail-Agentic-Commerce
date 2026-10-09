"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import {
  CATEGORIES,
  EVENT_WINDOW,
  formatSessionWhen,
  type CategoryId,
} from "@/lib/commerce/catalog";

function dubaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

function upcomingDays(): string[] {
  const today = dubaiToday();
  let cursor = today < EVENT_WINDOW.min || today > EVENT_WINDOW.max ? EVENT_WINDOW.min : today;
  const days: string[] = [];
  for (let index = 0; index < 7 && cursor <= EVENT_WINDOW.max; index += 1) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function hrefFor(category: CategoryId | null, date: string | null): string {
  const query = new URLSearchParams();
  if (category) query.set("category", category);
  if (date) query.set("date", date);
  const text = query.toString();
  return text ? `/catalog?${text}` : "/catalog";
}

export function CategoryFilters({
  active,
  activeDate = null,
}: {
  active: CategoryId | null;
  activeDate?: string | null;
}) {
  const router = useRouter();
  const chips = [{ id: null, label: "All" }, ...CATEGORIES];
  const days = upcomingDays();

  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Categories">
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const isActive = chip.id === active;
            return (
              <li key={chip.label}>
                <Link
                  href={hrefFor(chip.id, activeDate)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "h-8 px-4 py-0 text-caption",
                    isActive ? "btn-pill font-semibold" : "btn-outline"
                  )}
                >
                  {chip.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav aria-label="Dates">
        <ul className="flex flex-wrap items-center gap-2">
          <li>
            <Link
              href={hrefFor(active, null)}
              aria-current={activeDate ? undefined : "page"}
              className={cn(
                "h-8 px-4 py-0 text-caption",
                activeDate ? "btn-outline" : "btn-pill font-semibold"
              )}
            >
              All
            </Link>
          </li>
          {days.map((day) => (
            <li key={day}>
              <Link
                href={hrefFor(active, day)}
                aria-current={activeDate === day ? "page" : undefined}
                className={cn(
                  "h-8 px-4 py-0 text-caption",
                  activeDate === day ? "btn-pill font-semibold" : "btn-outline"
                )}
              >
                {formatSessionWhen(day)}
              </Link>
            </li>
          ))}
          <li>
            <label className="btn-outline inline-flex h-8 items-center gap-2 px-3 text-caption">
              Pick a date
              <input
                type="date"
                min={EVENT_WINDOW.min}
                max={EVENT_WINDOW.max}
                value={activeDate ?? ""}
                aria-label="Pick a date"
                className="bg-transparent text-caption"
                onChange={(event) => {
                  const value = event.target.value;
                  router.push(hrefFor(active, value || null));
                }}
              />
            </label>
          </li>
        </ul>
      </nav>
    </div>
  );
}
