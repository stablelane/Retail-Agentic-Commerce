import type { Metadata } from "next";

import { CatalogView } from "@/components/store/CatalogView";
import { categoryLabel, isCategory } from "@/lib/commerce/catalog";
import { listProducts } from "@/lib/commerce/merchant";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const { category: rawCategory } = await searchParams;
  const category = typeof rawCategory === "string" && isCategory(rawCategory) ? rawCategory : null;
  const { products } = await listProducts(category ? { category } : {});

  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-page) pt-8">
        <CatalogView
          title={category ? categoryLabel(category) : "Catalog"}
          activeCategory={category}
          products={products}
        />
      </div>
    </div>
  );
}
