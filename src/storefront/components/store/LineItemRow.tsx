"use client";

import { Minus, Plus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { promotionLabel, type AcpLineItem } from "@/lib/commerce/acp";
import type { CartItem } from "@/lib/commerce/cart-store";
import { productImageSrc } from "@/lib/commerce/catalog";
import { formatCents } from "@/lib/money";

interface LineItemRowProps {
  item: CartItem;
  /** Matching ACP line item once the session has synced. */
  line: AcpLineItem | undefined;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
  onNavigate?: (() => void) | undefined;
}

export function LineItemRow({
  item,
  line,
  onQuantityChange,
  onRemove,
  onNavigate,
}: LineItemRowProps) {
  const promotion = promotionLabel(line?.promotion);
  const lineTotal = line?.subtotal ?? item.price * item.quantity;
  const lineBase = line?.base_amount ?? item.price * item.quantity;
  const discounted = line !== undefined && line.discount > 0;
  const navigateProps = onNavigate ? { onClick: onNavigate } : {};

  return (
    <li className="flex gap-3 py-4">
      <Link
        href={`/products/${item.id}`}
        {...navigateProps}
        className="relative size-18 shrink-0 overflow-hidden rounded-tile bg-surface"
        tabIndex={-1}
        aria-hidden="true"
      >
        <Image
          src={productImageSrc(item.imageUrl)}
          alt=""
          fill
          sizes="72px"
          className="object-cover"
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/products/${item.id}`}
            {...navigateProps}
            className="truncate text-small font-semibold hover:underline"
          >
            {item.name}
          </Link>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.name}`}
            className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-text-secondary hover:text-text"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-micro text-text-secondary">{formatCents(item.price)} each</p>
        {promotion ? (
          <p className="text-micro font-semibold text-primary">Promotion · {promotion}</p>
        ) : null}

        <div className="mt-1 flex items-center justify-between gap-2">
          <div
            role="group"
            aria-label={`Quantity of ${item.name}`}
            className="flex items-center gap-1"
          >
            <button
              type="button"
              className="btn-primary size-8 p-0"
              aria-label={`Decrease quantity of ${item.name}`}
              disabled={item.quantity <= 1}
              onClick={() => onQuantityChange(item.quantity - 1)}
            >
              <Minus className="size-3.5" aria-hidden="true" />
            </button>
            <output aria-live="polite" className="w-7 text-center text-small font-semibold">
              {item.quantity}
            </output>
            <button
              type="button"
              className="btn-primary size-8 p-0"
              aria-label={`Increase quantity of ${item.name}`}
              disabled={item.quantity >= item.maxQuantity}
              onClick={() => onQuantityChange(item.quantity + 1)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="flex items-baseline gap-1.5 text-small font-semibold">
            {discounted ? (
              <s className="text-micro font-normal text-text-secondary">
                <span className="sr-only">Was </span>
                {formatCents(lineBase)}
              </s>
            ) : null}
            {formatCents(lineTotal)}
          </p>
        </div>
      </div>
    </li>
  );
}
