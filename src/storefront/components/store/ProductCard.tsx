import Image from "next/image";
import Link from "next/link";

import { Price } from "@/components/store/Price";
import { SaleBadge } from "@/components/store/SaleBadge";
import { formatSessionWhen, nextSession, productImageSrc } from "@/lib/commerce/catalog";
import type { Product } from "@/lib/commerce/merchant";
import { isOnSale } from "@/lib/money";

interface ProductCardProps {
  product: Product;
  /** Secondary line under the price, e.g. why a product was recommended. */
  caption?: string | undefined;
  onClick?: (() => void) | undefined;
  sizes?: string | undefined;
}

export function ProductCard({
  product,
  caption,
  onClick,
  sizes = "(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw",
}: ProductCardProps) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="group block h-full overflow-hidden rounded-card bg-surface transition duration-250 ease-hover hover:-translate-y-1 hover:shadow-float"
      {...(onClick ? { onClick } : {})}
    >
      <div className="relative aspect-square overflow-hidden">
        <Image
          src={productImageSrc(product.image_url)}
          alt={product.name}
          fill
          sizes={sizes}
          className="object-cover transition-transform duration-250 ease-hover group-hover:scale-[1.03]"
        />
        {isOnSale(product.base_price, product.compare_at_price) ? <SaleBadge /> : null}
      </div>
      <div className="px-3 pt-3 pb-4">
        <h3 className="truncate text-[15px] font-semibold text-text">{product.name}</h3>
        <p className="mt-1 truncate text-micro text-text-secondary">
          {[product.venue, formatSessionWhen(nextSession(product.sessions)?.starts_at ?? "")]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-micro text-text-secondary">From</span>
          <Price price={product.base_price} compareAtPrice={product.compare_at_price} />
        </div>
        {caption ? (
          <p className="mt-1.5 line-clamp-3 text-micro leading-[1.4] text-text-secondary">
            {caption}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
