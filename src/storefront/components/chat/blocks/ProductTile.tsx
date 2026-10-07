"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { ProductTileData } from "@/lib/agent/types";
import { cn } from "@/lib/cn";
import { cartStore, MAX_LINE_QUANTITY } from "@/lib/commerce/cart-store";
import { productImageSrc } from "@/lib/commerce/catalog";
import { formatCents, percentOff } from "@/lib/money";

interface ProductTileProps {
  product: ProductTileData;
  variant?: "carousel" | "detail";
  onOpen?: (() => void) | undefined;
}

function TilePrice({ product }: { product: ProductTileData }) {
  const discount = percentOff(product.price, product.compareAtPrice);
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-micro">
      <span className="text-text">
        {discount !== null ? <span className="sr-only">Sale price </span> : null}
        {formatCents(product.price)}
      </span>
      {discount !== null && product.compareAtPrice != null ? (
        <>
          <s className="text-text-secondary">
            <span className="sr-only">Regular price </span>
            {formatCents(product.compareAtPrice)}
          </s>
          <span className="rounded-badge bg-deal-bg px-1.5 py-0.5 text-[10px] leading-none font-bold text-deal-text">
            {discount}% OFF
          </span>
        </>
      ) : null}
    </p>
  );
}

function AddToBagLink({
  product,
  alwaysVisible,
}: {
  product: ProductTileData;
  alwaysVisible: boolean;
}) {
  const [added, setAdded] = useState(false);
  const stock = product.stockCount;
  const soldOut = stock !== undefined && stock <= 0;
  const max = Math.max(1, Math.min(MAX_LINE_QUANTITY, stock ?? MAX_LINE_QUANTITY));

  return (
    <button
      type="button"
      disabled={soldOut}
      aria-label={soldOut ? `${product.name} is sold out` : `Add ${product.name} to bag`}
      onClick={() => {
        cartStore.add(
          {
            id: product.id,
            name: product.name,
            price: product.price,
            imageUrl: productImageSrc(product.imageUrl),
          },
          1,
          max
        );
        setAdded(true);
      }}
      className={cn(
        "mt-1 self-start text-micro font-semibold text-primary transition-opacity disabled:text-text-secondary",
        !alwaysVisible &&
          !added &&
          "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
      )}
    >
      {soldOut ? "Sold out" : added ? "Added to bag" : "Add to bag"}
    </button>
  );
}

/** Chat carousel tile (§2.11): 134px image, name, price row with `NN% OFF`, hover-only add link. */
export function ProductTile({ product, variant = "carousel", onOpen }: ProductTileProps) {
  const { navigate } = useBlockActions();
  const href = `/products/${encodeURIComponent(product.id)}`;
  const open = () => {
    onOpen?.();
    navigate();
  };

  if (variant === "detail") {
    return (
      <div className="group flex gap-4">
        <Link href={href} onClick={open} className="shrink-0" tabIndex={-1} aria-hidden="true">
          <Image
            src={productImageSrc(product.imageUrl)}
            alt=""
            width={134}
            height={134}
            sizes="134px"
            className="size-[134px] rounded-tile object-cover"
          />
        </Link>
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={href} onClick={open} className="text-[15px] font-semibold text-text">
            {product.name}
          </Link>
          <TilePrice product={product} />
          {product.reasoning ? (
            <p className="text-micro text-text-secondary">{product.reasoning}</p>
          ) : null}
          <AddToBagLink product={product} alwaysVisible />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col">
      <Link href={href} onClick={open} className="flex flex-col gap-2">
        <Image
          src={productImageSrc(product.imageUrl)}
          alt=""
          width={134}
          height={134}
          sizes="134px"
          className="size-[134px] rounded-tile bg-surface object-cover"
        />
        <span className="flex flex-col gap-0.5">
          <span className="truncate text-caption font-semibold text-text">{product.name}</span>
          <TilePrice product={product} />
        </span>
      </Link>
      {product.reasoning ? (
        <p className="mt-1 line-clamp-3 text-micro leading-[1.4] text-text-secondary">
          {product.reasoning}
        </p>
      ) : null}
      <AddToBagLink product={product} alwaysVisible={false} />
    </div>
  );
}
