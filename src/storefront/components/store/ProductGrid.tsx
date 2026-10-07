import { ProductCard } from "@/components/store/ProductCard";
import type { Product } from "@/lib/commerce/merchant";

export function ProductGrid({ products }: { products: readonly Product[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
