import { render, screen, within } from "@testing-library/react";

import { OrderTimeline } from "@/components/orders/OrderTimeline";
import type { OrderStatusEvent } from "@/lib/commerce/merchant";
import { formatOrderDateTime } from "@/lib/commerce/orders";

const HISTORY: OrderStatusEvent[] = [
  { status: "order_confirmed", at: "2026-10-07T10:00:00Z" },
  { status: "order_shipped", at: "2026-10-07T10:02:00Z" },
  { status: "out_for_delivery", at: "2026-10-07T10:04:00Z" },
  { status: "delivered", at: "2026-10-07T10:06:00Z" },
];

function steps() {
  return within(screen.getByRole("list", { name: "Order progress" })).getAllByRole("listitem");
}

describe("OrderTimeline", () => {
  it("renders the four shipping steps in order", () => {
    render(<OrderTimeline status="order_confirmed" history={HISTORY.slice(0, 1)} />);

    expect(steps().map((step) => step.textContent)).toEqual([
      expect.stringContaining("Order confirmed"),
      expect.stringContaining("Shipped"),
      expect.stringContaining("Out for delivery"),
      expect.stringContaining("Delivered"),
    ]);
  });

  it("marks only the current step with aria-current", () => {
    render(<OrderTimeline status="order_shipped" history={HISTORY.slice(0, 2)} />);

    const items = steps();
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items.filter((item) => item.hasAttribute("aria-current"))).toHaveLength(1);
    expect(items.map((item) => item.dataset.state)).toEqual([
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("shows timestamps for reached steps only", () => {
    render(<OrderTimeline status="order_shipped" history={HISTORY.slice(0, 2)} />);

    const items = steps();
    const confirmedAt = items[0]?.querySelector("time");
    expect(confirmedAt).toHaveAttribute("datetime", HISTORY[0]?.at);
    expect(confirmedAt).toHaveTextContent(formatOrderDateTime("2026-10-07T10:00:00Z"));
    expect(items[1]?.querySelector("time")).toHaveAttribute("datetime", HISTORY[1]?.at);
    expect(items[2]?.querySelector("time")).toBeNull();
    expect(items[3]?.querySelector("time")).toBeNull();
  });

  it("treats delivered as the final current step with every step reached", () => {
    render(<OrderTimeline status="delivered" history={HISTORY} />);

    const items = steps();
    expect(items[3]).toHaveAttribute("aria-current", "step");
    expect(items.slice(0, 3).every((item) => item.dataset.state === "complete")).toBe(true);
    expect(items.every((item) => item.querySelector("time") !== null)).toBe(true);
  });

  it("announces each step's state to assistive technology", () => {
    render(<OrderTimeline status="out_for_delivery" history={HISTORY.slice(0, 3)} />);

    const items = steps();
    expect(items[0]).toHaveTextContent("(Completed)");
    expect(items[2]).toHaveTextContent("(Current step)");
    expect(items[3]).toHaveTextContent("(Upcoming)");
  });
});
