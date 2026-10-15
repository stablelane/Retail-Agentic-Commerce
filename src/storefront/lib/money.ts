const aed = new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" });

/** Format integer fils as AED, e.g. 35000 → "AED 350.00". */
export function formatCents(cents: number): string {
  return aed.format(cents / 100);
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

/** Format integer paise as INR, e.g. 35000 → "₹350.00". UPI amounts reuse the fils integers. */
export function formatPaise(paise: number): string {
  return inr.format(paise / 100);
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
