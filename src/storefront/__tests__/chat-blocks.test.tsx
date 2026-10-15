import { fireEvent, render, screen, within } from "@testing-library/react";

import { BlockActionsContext, type BlockActions } from "@/components/chat/blocks/BlockActions";
import { BlockRenderer } from "@/components/chat/blocks/BlockRenderer";
import { CartUpdateNotice } from "@/components/chat/blocks/CartUpdateNotice";
import type { UIBlock } from "@/lib/agent/types";
import { cartStore } from "@/lib/commerce/cart-store";

function renderBlock(block: unknown, overrides: Partial<BlockActions> = {}) {
  const actions: BlockActions = {
    send: vi.fn(),
    navigate: vi.fn(),
    viewBag: vi.fn(),
    email: "john@example.com",
    ...overrides,
  };
  const view = render(
    <BlockActionsContext.Provider value={actions}>
      <BlockRenderer block={block} />
    </BlockActionsContext.Provider>
  );
  return { ...view, actions };
}

const CAROUSEL: UIBlock = {
  type: "product_carousel",
  title: "Layers for cooler days",
  subtitle: "Outerwear picks for the week",
  products: [
    {
      id: "prod_3",
      name: "Graphic Tee",
      price: 3200,
      compareAtPrice: 4000,
      imageUrl: "/prod_3.jpeg",
      stockCount: 5,
    },
    { id: "prod_1", name: "Classic Tee", price: 2500, imageUrl: "/prod_1.jpeg" },
    { id: "prod_9", name: "Sold Out Cap", price: 1500, imageUrl: "/prod_9.jpeg", stockCount: 0 },
  ],
};

beforeEach(() => {
  cartStore.clear();
});

describe("ProductCarouselBlock", () => {
  it("renders the heading, names, prices, compare-at price and NN% OFF chip", () => {
    renderBlock(CAROUSEL);
    const section = screen.getByRole("region", { name: "Layers for cooler days" });
    expect(within(section).getByText("Outerwear picks for the week")).toBeInTheDocument();

    const links = within(section).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/products/prod_3",
      "/products/prod_1",
      "/products/prod_9",
    ]);
    const sale = links[0]!;
    expect(sale).toHaveTextContent("Graphic Tee");
    expect(sale).toHaveTextContent(/AED 32\.00/);
    expect(sale).toHaveTextContent(/AED 40\.00/);
    expect(within(sale).getByText("20% OFF")).toBeInTheDocument();

    expect(links[1]).toHaveTextContent(/AED 25\.00/);
    expect(within(links[1]!).queryByText(/% OFF/)).not.toBeInTheDocument();
  });

  it("adds a tile to the bag through the cart store", () => {
    const add = vi.spyOn(cartStore, "add");
    renderBlock(CAROUSEL);
    fireEvent.click(screen.getByRole("button", { name: "Add Graphic Tee to bag" }));

    expect(add).toHaveBeenCalledWith(
      { id: "prod_3", name: "Graphic Tee", price: 3200, imageUrl: "/prod_3.jpeg" },
      1,
      5
    );
    expect(cartStore.getSnapshot().items).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add Graphic Tee to bag" })).toHaveTextContent(
      "Added to bag"
    );
    expect(screen.getByRole("button", { name: "Sold Out Cap is sold out" })).toBeDisabled();
    add.mockRestore();
  });

  it("closes the overlay when a tile is opened", () => {
    const { actions } = renderBlock(CAROUSEL);
    const stopNavigation = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("click", stopNavigation);
    fireEvent.click(screen.getAllByRole("link")[1]!);
    window.removeEventListener("click", stopNavigation);
    expect(actions.navigate).toHaveBeenCalledTimes(1);
  });

  it("renders a single detail product", () => {
    renderBlock({ ...CAROUSEL, variant: "detail", products: [CAROUSEL.products[1]] });
    expect(screen.getByRole("link", { name: "Classic Tee" })).toHaveAttribute(
      "href",
      "/products/prod_1"
    );
    expect(screen.getByRole("button", { name: "Add Classic Tee to bag" })).toBeVisible();
  });
});

describe("OrderFormBlock", () => {
  const FORM: UIBlock = { type: "order_form", prefill: { email: "" }, reason: "missing_id" };

  it("prefills the signed-in email and validates before sending", () => {
    const { actions } = renderBlock(FORM);
    const orderInput = screen.getByRole("textbox", { name: "Order number" });
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveValue("john@example.com");

    fireEvent.click(screen.getByRole("button", { name: /Track Order/ }));
    expect(actions.send).not.toHaveBeenCalled();
    expect(orderInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter an order number like order_abc123.")).toBeInTheDocument();
    expect(orderInput).toHaveFocus();

    fireEvent.change(orderInput, { target: { value: " order_abc123 " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Track Order/ }));
    expect(actions.send).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the email used at checkout.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
      target: { value: "jane@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Track Order/ }));
    expect(actions.send).toHaveBeenCalledWith(
      "Track order order_abc123 for jane@example.com",
      "track_order"
    );
  });

  it("explains a not-found lookup and keeps the prefilled order id", () => {
    renderBlock({
      type: "order_form",
      prefill: { orderId: "order_x1", email: "a@b.co" },
      reason: "not_found",
    });
    expect(screen.getByText(/couldn't find that order/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Order number" })).toHaveValue("order_x1");
  });
});

describe("OrderStatusBlock", () => {
  it("renders the timeline, details and a safe order link", () => {
    renderBlock({
      type: "order_status",
      orderId: "order_abc123",
      status: "tickets_issued",
      statusHistory: [
        { status: "order_confirmed", at: "2026-01-01T10:00:00Z" },
        { status: "tickets_issued", at: "2026-01-01T10:02:00Z" },
      ],
      estimatedDelivery: "2026-01-05T00:00:00Z",
      trackingUrl: "javascript:alert(1)",
      carrier: "UPS",
      items: [{ name: "Classic Tee", quantity: 2 }],
      total: 5599,
    });

    const steps = within(screen.getByRole("list", { name: "Order progress" })).getAllByRole(
      "listitem"
    );
    expect(steps.map((step) => step.dataset.state)).toEqual(["complete", "current"]);
    expect(screen.getByText("UPS")).toBeInTheDocument();
    expect(screen.getByText("Classic Tee × 2")).toBeInTheDocument();
    expect(screen.getByText("AED 55.99")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Track package" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View order details" })).toHaveAttribute(
      "href",
      "/orders/order_abc123?email=john%40example.com"
    );
  });
});

describe("cart and checkout blocks", () => {
  it("cart summary shows ACP totals and opens the bag", () => {
    const { actions } = renderBlock({
      type: "cart_summary",
      items: [
        { id: "prod_1", name: "Classic Tee", price: 2500, quantity: 2, imageUrl: "/prod_1.jpeg" },
      ],
      totals: [
        { type: "subtotal", display_text: "Subtotal", amount: 5000 },
        { type: "total", display_text: "Total", amount: 5599 },
      ],
      sessionId: "checkout_1",
    });
    expect(screen.getByText("2 × AED 25.00")).toBeInTheDocument();
    expect(screen.getByText("AED 55.99")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to checkout" })).toHaveAttribute(
      "href",
      "/checkout"
    );
    fireEvent.click(screen.getByRole("button", { name: "View bag" }));
    expect(actions.viewBag).toHaveBeenCalledTimes(1);
  });

  it("cart summary without a session shows a client subtotal", () => {
    renderBlock({
      type: "cart_summary",
      items: [
        { id: "prod_1", name: "Classic Tee", price: 2500, quantity: 3, imageUrl: "/prod_1.jpeg" },
      ],
      totals: null,
      sessionId: null,
    });
    expect(screen.getByText("AED 75.00")).toBeInTheDocument();
    expect(screen.getByText("Taxes and shipping calculated at checkout")).toBeInTheDocument();
  });

  it("checkout panel links to /checkout and closes the overlay", () => {
    const { actions } = renderBlock({
      type: "checkout_panel",
      sessionId: "checkout_1",
      total: 5599,
      itemCount: 2,
    });
    expect(screen.getByText(/AED 55\.99/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Go to checkout" });
    expect(link).toHaveAttribute("href", "/checkout");
    const stopNavigation = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("click", stopNavigation);
    fireEvent.click(link);
    window.removeEventListener("click", stopNavigation);
    expect(actions.navigate).toHaveBeenCalledTimes(1);
  });

  it("cart update notice offers View bag", () => {
    const viewBag = vi.fn();
    render(
      <BlockActionsContext.Provider
        value={{ send: vi.fn(), navigate: vi.fn(), viewBag, email: "john@example.com" }}
      >
        <CartUpdateNotice itemCount={3} />
      </BlockActionsContext.Provider>
    );
    expect(screen.getByRole("status")).toHaveTextContent("Bag updated — 3 items.");
    fireEvent.click(screen.getByRole("button", { name: "View bag" }));
    expect(viewBag).toHaveBeenCalled();
  });
});

describe("account and notification blocks", () => {
  it("account summary formats points and membership", () => {
    renderBlock({
      type: "account_summary",
      name: "John Doe",
      email: "john@example.com",
      tier: "Gold",
      loyaltyPoints: 1250,
      memberSince: "2024-03-15",
    });
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("March 2024")).toBeInTheDocument();
    expect(screen.getByText("Gold")).toBeInTheDocument();
  });

  it("notification shows the message, status and order link", () => {
    renderBlock({
      type: "notification",
      subject: "On its way",
      message: "Your order shipped.",
      status: "order_shipped",
      orderId: "order_1",
      trackingUrl: "https://track.example.com/order_1",
      receivedAt: "2026-01-01T10:00:00Z",
    });
    expect(screen.getByText("Your order shipped.")).toBeInTheDocument();
    expect(screen.getByText("Shipped")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View order" })).toHaveAttribute(
      "href",
      "/orders/order_1?email=john%40example.com"
    );
    expect(screen.getByRole("link", { name: "Track package" })).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
  });
});

describe("UPI blocks", () => {
  const MANDATE: UIBlock = {
    type: "upi_mandate",
    mandateId: "mdt_1",
    mobile: "9876543210",
    amountBlocked: 200_000,
    amountAvailable: 200_000,
    status: "ACTIVE",
    deepLink: null,
    expiresAt: null,
  };

  it("mandate shows the blocked amount and status", () => {
    renderBlock(MANDATE);
    const section = screen.getByRole("region", { name: "UPI mandate" });
    expect(within(section).getByRole("status")).toHaveTextContent("Active");
    expect(section).toHaveTextContent("₹2,000");
    expect(section).toHaveTextContent("9876543210");
  });

  it("pending mandate offers a safe deep link", () => {
    renderBlock({ ...MANDATE, status: "CREATED", deepLink: "https://pay.example/m" });
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for approval");
    expect(screen.getByRole("link", { name: "Open UPI app" })).toHaveAttribute(
      "href",
      "https://pay.example/m"
    );
  });

  const PAID: UIBlock = {
    type: "upi_payment",
    status: "paid",
    orderId: "order_upi1",
    email: "john@example.com",
    total: 3099,
    receipt: "rcpt_1",
    reason: null,
    spentToday: 3099,
  };

  it("paid links to the order with the email", () => {
    renderBlock(PAID);
    const section = screen.getByRole("region", { name: "UPI payment" });
    expect(section).toHaveTextContent("Paid ₹30.99 via UPI");
    expect(within(section).getByRole("link", { name: "View order" })).toHaveAttribute(
      "href",
      "/orders/order_upi1?email=john%40example.com"
    );
  });

  it.each([
    ["pending", "Payment is processing"],
    ["refused", "Payment refused by your spending limits"],
    ["failed", "Payment failed"],
  ])("%s renders its message", (status, text) => {
    renderBlock({ ...PAID, status, orderId: null, total: null, reason: "why" });
    const section = screen.getByRole("region", { name: "UPI payment" });
    expect(section).toHaveTextContent(text);
    expect(section).toHaveTextContent("why");
    expect(within(section).queryByRole("link", { name: "View order" })).toBeNull();
  });
});

describe("BlockRenderer", () => {
  it.each([[{ type: "hologram" }], [null], ["text"], [{ type: "product_carousel" }]])(
    "renders nothing for %j",
    (block) => {
      const { container } = renderBlock(block);
      expect(container).toBeEmptyDOMElement();
    }
  );
});
