import type { Metadata } from "next";

import { CatalogView } from "@/components/store/CatalogView";
import { categoryLabel, isCategory, nextSession } from "@/lib/commerce/catalog";
import { listProducts, type Product } from "@/lib/commerce/merchant";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "What’s On" };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function byNextSession(products: readonly Product[]): Product[] {
  return [...products].sort((a, b) => {
    const left = nextSession(a.sessions)?.starts_at ?? "9999";
    const right = nextSession(b.sessions)?.starts_at ?? "9999";
    return left.localeCompare(right) || a.id.localeCompare(b.id);
  });
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[]; date?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawCategory = params.category;
  const rawDate = params.date;
  const category = typeof rawCategory === "string" && isCategory(rawCategory) ? rawCategory : null;
  const date = typeof rawDate === "string" && DATE_PATTERN.test(rawDate) ? rawDate : null;
  const { products } = await listProducts({
    ...(category ? { category } : {}),
    ...(date ? { date } : {}),
  });

  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-page) pt-8">
        <CatalogView
          title={category ? categoryLabel(category) : "What’s On"}
          activeCategory={category}
          activeDate={date}
          products={byNextSession(products)}
        />
      </div>
    </div>
  );
}
