"use client";

import { useMemo, useState } from "react";

import { OpenChatButton } from "@/components/chat/OpenChatButton";
import { CategoryFilters } from "@/components/store/CategoryFilters";
import { ProductGrid } from "@/components/store/ProductGrid";
import { SectionTitle } from "@/components/store/SectionTitle";
import type { CategoryId } from "@/lib/commerce/catalog";
import type { Product } from "@/lib/commerce/merchant";

const SORT_OPTIONS = [
  { id: "featured", label: "Featured" },
  { id: "price-asc", label: "Price: low → high" },
  { id: "price-desc", label: "Price: high → low" },
] as const;

type SortId = (typeof SORT_OPTIONS)[number]["id"];

function sortProducts(products: readonly Product[], sort: SortId): readonly Product[] {
  if (sort === "featured") return products;
  const direction = sort === "price-asc" ? 1 : -1;
  return [...products].sort((a, b) => direction * (a.base_price - b.base_price));
}

interface CatalogViewProps {
  title: string;
  activeCategory: CategoryId | null;
  activeDate?: string | null;
  products: readonly Product[];
}

export function CatalogView({
  title,
  activeCategory,
  activeDate = null,
  products,
}: CatalogViewProps) {
  const [sort, setSort] = useState<SortId>("featured");
  const sorted = useMemo(() => sortProducts(products, sort), [products, sort]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <SectionTitle as="h1">{title}</SectionTitle>
        <CategoryFilters active={activeCategory} activeDate={activeDate} />
        <label className="ml-auto flex items-center gap-2 text-caption text-text-secondary">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortId)}
            className="rounded-pill border-[1.6px] border-black/15 bg-white px-3 py-1.5 text-caption text-text"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4">
        {sorted.length > 0 ? (
          <ProductGrid products={sorted} />
        ) : (
          <div className="flex flex-col items-start gap-4 rounded-card bg-surface p-8">
            <p className="text-small text-text">
              Nothing here yet — try another category or ask the assistant.
            </p>
            <OpenChatButton />
          </div>
        )}
      </div>
    </>
  );
}
