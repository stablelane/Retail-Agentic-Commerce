import { Hero } from "@/components/store/Hero";
import { ProductGrid } from "@/components/store/ProductGrid";
import { SectionTitle } from "@/components/store/SectionTitle";
import { nextSession } from "@/lib/commerce/catalog";
import { listProducts } from "@/lib/commerce/merchant";
import { homeContent } from "@/lib/content/home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { products } = await listProducts();
  const sorted = [...products].sort((a, b) => {
    const left = nextSession(a.sessions)?.starts_at ?? "9999";
    const right = nextSession(b.sessions)?.starts_at ?? "9999";
    return left.localeCompare(right) || a.id.localeCompare(b.id);
  });

  return (
    <>
      <Hero />
      <section aria-labelledby="home-grid-title" className="px-4 pt-8 sm:px-8">
        <div className="mx-auto max-w-(--container-page)">
          <SectionTitle id="home-grid-title" className="mb-4">
            {homeContent.gridTitle}
          </SectionTitle>
          <ProductGrid products={sorted} />
        </div>
      </section>
    </>
  );
}
