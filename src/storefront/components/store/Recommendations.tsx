"use client";

import { useEffect, useState } from "react";

import { ProductCard } from "@/components/store/ProductCard";
import { SectionTitle } from "@/components/store/SectionTitle";
import { proxyRequest } from "@/lib/commerce/acp";
import { cartStore } from "@/lib/commerce/cart-store";
import type { Product } from "@/lib/commerce/merchant";
import { normalizeRecommendations } from "@/lib/commerce/mcp-protocol";

const MCP_PROXY_PATH = "/api/mcp-proxy";
const MAX_TILES = 6;
const MAX_CART_CONTEXT = 50;
const SKELETON_TILES = 3;
/** Slightly above the server-side MCP timeout (90s) so the proxy answers first. */
const REQUEST_TIMEOUT_MS = 95_000;

interface RecommendedProduct {
  product: Product;
  reasoning: string;
}

interface RecommendationResult {
  requestId: string | null;
  items: RecommendedProduct[];
}

type State =
  { status: "loading" } | ({ status: "ready" } & RecommendationResult) | { status: "hidden" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function postMcp(name: string, args: Record<string, unknown>, init: RequestInit = {}) {
  return fetch(MCP_PROXY_PATH, {
    ...init,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ name, arguments: args }),
    cache: "no-store",
  });
}

async function loadRecommendations(
  productId: string,
  productName: string,
  signal: AbortSignal
): Promise<RecommendationResult | null> {
  const { items, sessionId } = cartStore.getSnapshot();
  const response = await postMcp(
    "get-recommendations",
    {
      productId,
      productName,
      cartItems: items
        .slice(0, MAX_CART_CONTEXT)
        .map((item) => ({ productId: item.id, name: item.name, price: item.price })),
      sessionId,
    },
    { signal }
  );
  if (!response.ok) return null;

  const body: unknown = await response.json();
  if (!isRecord(body) || body.isError === true || !isRecord(body.result)) return null;

  const { recommendationRequestId, recommendations } = normalizeRecommendations(
    body.result,
    MAX_TILES + 1
  );
  const picks = recommendations
    .filter((recommendation) => recommendation.productId !== productId)
    .slice(0, MAX_TILES);

  // The agent returns ids only; hydrate price, image and sale data from the catalog.
  const products = await Promise.allSettled(
    picks.map((pick) =>
      proxyRequest<Product>("merchant", `/products/${encodeURIComponent(pick.productId)}`)
    )
  );
  const hydrated: RecommendedProduct[] = [];
  products.forEach((result, index) => {
    const pick = picks[index];
    if (result.status === "fulfilled" && pick && result.value.id === pick.productId) {
      hydrated.push({ product: result.value, reasoning: pick.reasoning });
    }
  });
  return { requestId: recommendationRequestId, items: hydrated };
}

/** Fire-and-forget click attribution; navigation never waits on it. */
function trackClick(productId: string, requestId: string, position: number) {
  postMcp(
    "track-recommendation-click",
    {
      productId,
      recommendationRequestId: requestId,
      sessionId: cartStore.getSnapshot().sessionId,
      position,
      source: "storefront_pdp",
    },
    { keepalive: true }
  ).catch(() => undefined);
}

/** PDP "You might also like" row from the recommendation agent; hidden on error or empty. */
export function Recommendations({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    loadRecommendations(productId, productName, controller.signal)
      .then((result) => {
        if (!active) return;
        setState(
          result && result.items.length > 0 ? { status: "ready", ...result } : { status: "hidden" }
        );
      })
      .catch(() => {
        if (active) setState({ status: "hidden" });
      })
      .finally(() => clearTimeout(timer));

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [productId, productName]);

  if (state.status === "hidden") return null;
  const loading = state.status === "loading";

  return (
    <section
      aria-labelledby="recommendations-title"
      aria-busy={loading}
      className="mx-auto max-w-(--container-page) pt-12 pb-16"
    >
      <SectionTitle id="recommendations-title">You might also like</SectionTitle>
      {loading ? (
        <p role="status" className="sr-only">
          Loading recommendations
        </p>
      ) : null}
      <ul className="-mx-4 mt-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:scroll-px-8 sm:px-8">
        {state.status === "ready"
          ? state.items.map(({ product, reasoning }, index) => {
              const { requestId } = state;
              return (
                <li key={product.id} className="w-40 shrink-0 snap-start sm:w-48">
                  <ProductCard
                    product={product}
                    caption={reasoning}
                    sizes="192px"
                    onClick={
                      requestId ? () => trackClick(product.id, requestId, index + 1) : undefined
                    }
                  />
                </li>
              );
            })
          : Array.from({ length: SKELETON_TILES }, (_, index) => (
              <li key={index} aria-hidden="true" className="w-40 shrink-0 sm:w-48">
                <div className="overflow-hidden rounded-card bg-surface">
                  <div className="aspect-square animate-pulse bg-surface-strong" />
                  <div className="space-y-2 px-3 pt-3 pb-4">
                    <div className="h-4 w-3/4 animate-pulse rounded-badge bg-surface-strong" />
                    <div className="h-3 w-1/3 animate-pulse rounded-badge bg-surface-strong" />
                  </div>
                </div>
              </li>
            ))}
      </ul>
    </section>
  );
}
