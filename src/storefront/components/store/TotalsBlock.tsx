import type { AcpTotal } from "@/lib/commerce/acp";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";

const DISCOUNT_TYPES = new Set(["items_discount", "discount"]);

interface TotalsBlockProps {
  /** ACP session totals; when null, a client-side subtotal is shown instead. */
  totals: readonly AcpTotal[] | null;
  fallbackSubtotal?: number;
  className?: string;
}

export function TotalsBlock({ totals, fallbackSubtotal = 0, className }: TotalsBlockProps) {
  if (!totals) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <dl className="flex justify-between text-small font-semibold">
          <dt>Subtotal</dt>
          <dd>{formatCents(fallbackSubtotal)}</dd>
        </dl>
        <p className="text-micro text-text-secondary">Taxes and shipping calculated at checkout</p>
      </div>
    );
  }

  return (
    <dl className={cn("flex flex-col gap-2 text-small", className)}>
      {totals
        .filter((total) => !(DISCOUNT_TYPES.has(total.type) && total.amount === 0))
        .map((total) => {
          const isTotal = total.type === "total";
          const isDiscount = DISCOUNT_TYPES.has(total.type);
          return (
            <div
              key={total.type}
              className={cn(
                "flex justify-between gap-4",
                isTotal && "mt-1 border-t border-line pt-3 text-body font-semibold"
              )}
            >
              <dt className={cn(!isTotal && "text-text-secondary")}>{total.display_text}</dt>
              <dd className={cn(isDiscount && "text-primary")}>
                {isDiscount ? `−${formatCents(total.amount)}` : formatCents(total.amount)}
              </dd>
            </div>
          );
        })}
    </dl>
  );
}
