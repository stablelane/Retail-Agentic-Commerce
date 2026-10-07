import { formatCents, isOnSale, percentOff } from "@/lib/money";

describe("formatCents", () => {
  it.each([
    [2500, "$25.00"],
    [3200, "$32.00"],
    [4000, "$40.00"],
    [599, "$5.99"],
    [0, "$0.00"],
    [123456, "$1,234.56"],
  ])("formats %i cents as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe("percentOff", () => {
  it("rounds the saving against the compare-at price", () => {
    expect(percentOff(3200, 4000)).toBe(20);
    expect(percentOff(7500, 9500)).toBe(21);
    expect(percentOff(2200, 2800)).toBe(21);
    expect(percentOff(4200, 5200)).toBe(19);
  });

  it("returns null when there is no sale", () => {
    expect(percentOff(2500, null)).toBeNull();
    expect(percentOff(2500, undefined)).toBeNull();
    expect(percentOff(2500, 2500)).toBeNull();
    expect(percentOff(2500, 2000)).toBeNull();
    expect(percentOff(0, 0)).toBeNull();
  });
});

describe("isOnSale", () => {
  it("is true only when compare-at exceeds the price", () => {
    expect(isOnSale(3200, 4000)).toBe(true);
    expect(isOnSale(2500, null)).toBe(false);
    expect(isOnSale(2500, 2500)).toBe(false);
  });
});
