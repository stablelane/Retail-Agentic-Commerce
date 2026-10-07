import type { OrderStatusEvent, ShippingStatus } from "@/lib/commerce/merchant";
import { SHIPPING_STEPS, formatOrderDateTime } from "@/lib/commerce/orders";
import { cn } from "@/lib/cn";

interface OrderTimelineProps {
  status: ShippingStatus;
  history: readonly OrderStatusEvent[];
  className?: string;
}

type StepState = "complete" | "current" | "upcoming";

const STATE_LABEL: Record<StepState, string> = {
  complete: "Completed",
  current: "Current step",
  upcoming: "Upcoming",
};

export function OrderTimeline({ status, history, className }: OrderTimelineProps) {
  const currentIndex = Math.max(
    0,
    SHIPPING_STEPS.findIndex((step) => step.status === status)
  );
  const reachedAt = new Map(history.map((event) => [event.status, event.at]));

  return (
    <ol aria-label="Order progress" className={cn("grid gap-4 sm:grid-cols-4 sm:gap-2", className)}>
      {SHIPPING_STEPS.map((step, index) => {
        const state: StepState =
          index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
        const at = state === "upcoming" ? undefined : reachedAt.get(step.status);
        return (
          <li
            key={step.status}
            aria-current={state === "current" ? "step" : undefined}
            data-state={state}
            className="flex items-start gap-3 sm:flex-col sm:gap-2"
          >
            <span className="flex w-full items-center gap-2" aria-hidden="true">
              <span
                className={cn(
                  "size-4 shrink-0 rounded-full",
                  state === "current" && "bg-primary ring-4 ring-primary-soft/60",
                  state === "complete" && "bg-primary-soft",
                  state === "upcoming" && "bg-surface-strong"
                )}
              />
              <span
                className={cn(
                  "hidden h-0.5 flex-1 rounded-pill sm:block",
                  index === SHIPPING_STEPS.length - 1 && "sm:hidden",
                  index < currentIndex ? "bg-primary-soft" : "bg-surface-strong"
                )}
              />
            </span>
            <span className="flex flex-col">
              <span
                className={cn(
                  "text-small font-semibold",
                  state === "upcoming" && "text-text-secondary",
                  state === "current" && "text-primary"
                )}
              >
                {step.label}
              </span>
              <span className="sr-only">({STATE_LABEL[state]})</span>
              {at ? (
                <time dateTime={at} className="text-micro text-text-secondary">
                  {formatOrderDateTime(at)}
                </time>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
