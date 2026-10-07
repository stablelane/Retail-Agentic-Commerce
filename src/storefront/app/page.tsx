import { Hero } from "@/components/store/Hero";
import { ProductGrid } from "@/components/store/ProductGrid";
import { SectionTitle } from "@/components/store/SectionTitle";
import { listProducts } from "@/lib/commerce/merchant";
import { homeContent } from "@/lib/content/home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { products } = await listProducts();

  return (
    <>
      <Hero />
      <section aria-labelledby="home-grid-title" className="px-4 pt-8 sm:px-8">
        <div className="mx-auto max-w-(--container-page)">
          <SectionTitle id="home-grid-title" className="mb-4">
            {homeContent.gridTitle}
          </SectionTitle>
          <ProductGrid products={products} />
        </div>
      </section>
    </>
  );
}
