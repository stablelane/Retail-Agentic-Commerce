import { cn } from "@/lib/cn";
import { formatCents, percentOff } from "@/lib/money";

interface PriceProps {
  price: number;
  compareAtPrice: number | null;
  size?: "card" | "detail";
}

export function Price({ price, compareAtPrice, size = "card" }: PriceProps) {
  const discount = percentOff(price, compareAtPrice);
  const detail = size === "detail";

  return (
    <p className="flex items-baseline gap-1.5">
      <span className={cn("font-semibold text-text", detail ? "text-body-l" : "text-caption")}>
        {discount !== null ? <span className="sr-only">Sale price </span> : null}
        {formatCents(price)}
      </span>
      {discount !== null && compareAtPrice !== null ? (
        <>
          <s className={cn("text-text-secondary", detail ? "text-small" : "text-micro")}>
            <span className="sr-only">Regular price </span>
            {formatCents(compareAtPrice)}
          </s>
          {detail ? (
            <span className="text-caption font-semibold text-primary">-{discount}%</span>
          ) : null}
        </>
      ) : null}
    </p>
  );
}
