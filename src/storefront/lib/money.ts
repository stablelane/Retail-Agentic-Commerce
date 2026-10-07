const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Format integer cents as USD, e.g. 2500 → "$25.00". */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/**
 * Whole-number percent saved versus the compare-at price, e.g. (3200, 4000) → 20.
 * Returns null when the product is not on sale.
 */
export function percentOff(
  price: number,
  compareAtPrice: number | null | undefined
): number | null {
  if (compareAtPrice == null || compareAtPrice <= 0 || compareAtPrice <= price) {
    return null;
  }
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}

export function isOnSale(price: number, compareAtPrice: number | null | undefined): boolean {
  return percentOff(price, compareAtPrice) !== null;
}
