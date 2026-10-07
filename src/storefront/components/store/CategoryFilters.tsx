import Link from "next/link";

import { cn } from "@/lib/cn";
import { CATEGORIES, type CategoryId } from "@/lib/commerce/catalog";

export function CategoryFilters({ active }: { active: CategoryId | null }) {
  const chips = [{ id: null, label: "All" }, ...CATEGORIES];

  return (
    <nav aria-label="Categories">
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const isActive = chip.id === active;
          return (
            <li key={chip.label}>
              <Link
                href={chip.id ? `/catalog?category=${chip.id}` : "/catalog"}
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
  );
}
