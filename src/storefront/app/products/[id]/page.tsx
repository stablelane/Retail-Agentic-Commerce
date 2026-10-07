import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { cache } from "react";

import { AddToBag } from "@/components/store/AddToBag";
import { Price } from "@/components/store/Price";
import { Recommendations } from "@/components/store/Recommendations";
import { SaleBadge } from "@/components/store/SaleBadge";
import { categoryLabel, isCategory, isProductId, productImageSrc } from "@/lib/commerce/catalog";
import { getProduct } from "@/lib/commerce/merchant";
import { isOnSale } from "@/lib/money";

export const dynamic = "force-dynamic";

interface ProductPageProps {
  params: Promise<{ id: string }>;
}

const loadProduct = cache(async (id: string) => (isProductId(id) ? getProduct(id) : null));

function stockCopy(stockCount: number): string {
  if (stockCount <= 0) return "Out of stock";
  if (stockCount < 10) return `Only ${stockCount} left`;
  return "In stock";
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const product = await loadProduct((await params).id);
  return product ? { title: product.name, description: product.description } : {};
}

export default async function ProductPage({ params }: ProductPageProps) {
  const product = await loadProduct((await params).id);
  if (!product) notFound();

  const onSale = isOnSale(product.base_price, product.compare_at_price);

  return (
    <div className="px-4 pt-14 sm:px-8">
      <article className="mx-auto grid max-w-(--container-page) gap-8 pt-8 md:grid-cols-2">
        <div className="relative aspect-square self-start overflow-hidden rounded-card bg-surface md:sticky md:top-22">
          <Image
            src={productImageSrc(product.image_url)}
            alt={product.name}
            fill
            priority
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
          {onSale ? <SaleBadge /> : null}
        </div>

        <div className="flex max-w-(--container-content) flex-col gap-6">
          <div>
            {product.category && isCategory(product.category) ? (
              <p className="text-caption text-text-secondary">{categoryLabel(product.category)}</p>
            ) : null}
            <h1 className="mt-1 font-serif text-h2 leading-[1.1] font-normal">{product.name}</h1>
            <div className="mt-3">
              <Price
                price={product.base_price}
                compareAtPrice={product.compare_at_price}
                size="detail"
              />
            </div>
            <p className="mt-1 text-caption text-text-secondary">
              {stockCopy(product.stock_count)}
            </p>
          </div>

          {product.description ? (
            <p className="text-body leading-[1.5] text-text">{product.description}</p>
          ) : null}

          {product.attributes.length > 0 ? (
            <ul aria-label="Attributes" className="flex flex-wrap gap-2">
              {product.attributes.map((attribute) => (
                <li key={attribute} className="btn-outline px-3 py-1">
                  {attribute}
                </li>
              ))}
            </ul>
          ) : null}

          <AddToBag
            product={{
              id: product.id,
              name: product.name,
              price: product.base_price,
              imageUrl: product.image_url,
            }}
            stockCount={product.stock_count}
          />
        </div>
      </article>

      <Recommendations key={product.id} productId={product.id} productName={product.name} />
    </div>
  );
}
