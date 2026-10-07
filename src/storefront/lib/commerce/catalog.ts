export const CATEGORIES = [
  { id: "tops", label: "Tops" },
  { id: "bottoms", label: "Bottoms" },
  { id: "outerwear", label: "Outerwear" },
  { id: "footwear", label: "Footwear" },
  { id: "accessories", label: "Accessories" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

const PRODUCT_ID_PATTERN = /^prod_[a-z0-9_]+$/;
const LOCAL_IMAGE_PATTERN = /^\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|avif)$/;
const FALLBACK_IMAGE = "/prod_1.jpeg";

export function isCategory(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

export function isProductId(value: string): boolean {
  return PRODUCT_ID_PATTERN.test(value);
}

/** Product images are served from this app's public/ folder; anything else falls back. */
export function productImageSrc(imageUrl: string | null | undefined): string {
  return imageUrl && LOCAL_IMAGE_PATTERN.test(imageUrl) ? imageUrl : FALLBACK_IMAGE;
}
