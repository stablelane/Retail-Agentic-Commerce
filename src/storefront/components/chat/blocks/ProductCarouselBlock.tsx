"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BlockHeading } from "@/components/chat/blocks/BlockHeading";
import { ProductTile } from "@/components/chat/blocks/ProductTile";
import type { ProductCarouselBlock as ProductCarouselBlockData } from "@/lib/agent/types";
import { cartStore } from "@/lib/commerce/cart-store";

/** Fire-and-forget click attribution for recommended products. */
function trackRecommendationClick(productId: string, requestId: string, position: number) {
  fetch("/api/mcp-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: "track-recommendation-click",
      arguments: {
        productId,
        recommendationRequestId: requestId,
        sessionId: cartStore.getSnapshot().sessionId,
        position,
        source: "storefront_chat",
      },
    }),
    keepalive: true,
    cache: "no-store",
  }).catch(() => undefined);
}

export function ProductCarouselBlock({ block }: { block: ProductCarouselBlockData }) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const products = block.products.filter((product) => product && typeof product.id === "string");
  const requestId = block.recommendationRequestId;

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setCanPrev(scroller.scrollLeft > 4);
    setCanNext(scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [measure]);

  function page(direction: 1 | -1) {
    const scroller = scrollerRef.current;
    scroller?.scrollBy?.({ left: direction * scroller.clientWidth, behavior: "smooth" });
  }

  if (products.length === 0) return null;

  if (block.variant === "detail" && products.length === 1 && products[0]) {
    return (
      <section aria-label={block.title || products[0].name} className="flex flex-col gap-3">
        <BlockHeading title={block.title} subtitle={block.subtitle} />
        <ProductTile product={products[0]} variant="detail" />
      </section>
    );
  }

  return (
    <section aria-label={block.title || "Products"} className="flex flex-col gap-3">
      <BlockHeading title={block.title} subtitle={block.subtitle} />
      <div className="relative -mr-5">
        <ul
          ref={scrollerRef}
          onScroll={measure}
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto pr-5 pb-1 [scrollbar-width:none]"
        >
          {products.map((product, index) => (
            <li key={product.id} className="w-[134px] shrink-0 snap-start">
              <ProductTile
                product={product}
                onOpen={
                  requestId
                    ? () => trackRecommendationClick(product.id, requestId, index + 1)
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
        {canPrev ? (
          <button
            type="button"
            onClick={() => page(-1)}
            aria-label="Scroll products left"
            className="absolute top-[51px] left-0 grid size-8 -translate-x-1/2 place-items-center rounded-full bg-white text-text shadow-float"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        {canNext ? (
          <button
            type="button"
            onClick={() => page(1)}
            aria-label="Scroll products right"
            className="absolute top-[51px] right-2 grid size-8 place-items-center rounded-full bg-white text-text shadow-float"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
