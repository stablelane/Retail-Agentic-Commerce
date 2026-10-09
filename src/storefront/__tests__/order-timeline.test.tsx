import { render, screen, within } from "@testing-library/react";

import { OrderTimeline } from "@/components/orders/OrderTimeline";
import type { OrderStatusEvent } from "@/lib/commerce/merchant";
import { formatOrderDateTime } from "@/lib/commerce/orders";

const HISTORY: OrderStatusEvent[] = [
  { status: "order_confirmed", at: "2026-10-07T10:00:00Z" },
  { status: "tickets_issued", at: "2026-10-07T10:02:00Z" },
];

function steps() {
  return within(screen.getByRole("list", { name: "Order progress" })).getAllByRole("listitem");
}

describe("OrderTimeline", () => {
  it("renders confirmed then tickets issued", () => {
    render(<OrderTimeline status="order_confirmed" history={HISTORY.slice(0, 1)} />);

    expect(steps().map((step) => step.textContent)).toEqual([
      expect.stringContaining("Confirmed"),
      expect.stringContaining("Tickets issued"),
    ]);
  });

  it("marks only the current step with aria-current", () => {
    render(<OrderTimeline status="tickets_issued" history={HISTORY} />);

    const items = steps();
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items.filter((item) => item.hasAttribute("aria-current"))).toHaveLength(1);
    expect(items.map((item) => item.dataset.state)).toEqual(["complete", "current"]);
  });

  it("shows timestamps for reached steps only", () => {
    render(<OrderTimeline status="order_confirmed" history={HISTORY.slice(0, 1)} />);

    const items = steps();
    const confirmedAt = items[0]?.querySelector("time");
    expect(confirmedAt).toHaveAttribute("datetime", HISTORY[0]?.at);
    expect(confirmedAt).toHaveTextContent(formatOrderDateTime("2026-10-07T10:00:00Z"));
    expect(items[1]?.querySelector("time")).toBeNull();
  });

  it("treats tickets issued as the final current step", () => {
    render(<OrderTimeline status="tickets_issued" history={HISTORY} />);

    const items = steps();
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]?.dataset.state).toBe("complete");
    expect(items.every((item) => item.querySelector("time") !== null)).toBe(true);
  });

  it("announces each step's state to assistive technology", () => {
    render(<OrderTimeline status="tickets_issued" history={HISTORY} />);

    const items = steps();
    expect(items[0]).toHaveTextContent("(Completed)");
    expect(items[1]).toHaveTextContent("(Current step)");
  });
});
