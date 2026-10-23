import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { BlockActionsContext, type BlockActions } from "@/components/chat/blocks/BlockActions";
import { BlockRenderer } from "@/components/chat/blocks/BlockRenderer";
import type { CheckoutSession } from "@/lib/commerce/acp";
import { cartStore } from "@/lib/commerce/cart-store";
import { completeSession, prepareSessionForPayment } from "@/lib/commerce/checkout";
import { createPaymentIntent } from "@/lib/commerce/stripe";

const confirmPayment = vi.fn();

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({}),
}));

vi.mock("@/lib/commerce/stripe", () => ({
  createPaymentIntent: vi.fn(),
  getStripe: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/commerce/checkout", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/commerce/checkout")>()),
  prepareSessionForPayment: vi.fn(),
  completeSession: vi.fn(),
}));

const SESSION = { id: "checkout_abc", totals: [], currency: "aed" } as unknown as CheckoutSession;

vi.mock("@/lib/commerce/session-sync", () => ({
  getSessionSyncer: () => ({
    withSyncedSession: <T,>(task: (session: CheckoutSession) => Promise<T>) => task(SESSION),
  }),
}));

const BLOCK = {
  type: "checkout_panel",
  sessionId: "checkout_abc",
  total: 35000,
  itemCount: 1,
  embeddedPayment: true,
};
const PAY = /^Pay AED\s350\.00$/;

function renderPanel() {
  const actions: BlockActions = {
    send: vi.fn(),
    navigate: vi.fn(),
    viewBag: vi.fn(),
    email: "john@example.com",
  };
  return render(
    <BlockActionsContext.Provider value={actions}>
      <BlockRenderer block={BLOCK} />
    </BlockActionsContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cartStore.clear();
  cartStore.add({ id: "prod_1", name: "Opera Night", price: 35000, imageUrl: "/prod_1.jpeg" });
  vi.mocked(prepareSessionForPayment).mockResolvedValue({ ready: SESSION, amount: 35000 });
  vi.mocked(createPaymentIntent).mockResolvedValue({
    clientSecret: "pi_123_secret_456",
    publishableKey: "pk_test_123",
    paymentIntentId: "pi_123",
    amount: 35000,
    currency: "aed",
  });
});

async function openPaymentForm() {
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: PAY }));
  await screen.findByTestId("payment-element");
}

describe("StripePaymentPanel", () => {
  it("authorizes, completes with the PaymentIntent id, and clears the bag", async () => {
    confirmPayment.mockResolvedValue({
      paymentIntent: { id: "pi_123", status: "requires_capture" },
    });
    vi.mocked(completeSession).mockResolvedValue({
      orderId: "order_789",
      session: { ...SESSION, totals: [{ type: "total", display_text: "Total", amount: 35000 }] },
    });
    await openPaymentForm();
    expect(createPaymentIntent).toHaveBeenCalledWith("checkout_abc");

    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Card payment" }));
    });

    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({ redirect: "if_required" })
    );
    expect(completeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "checkout_abc", token: "pi_123", provider: "stripe" })
    );
    expect(await screen.findByRole("link", { name: "View order" })).toHaveAttribute(
      "href",
      expect.stringContaining("order_789")
    );
    expect(cartStore.getSnapshot().items).toHaveLength(0);
  });

  it("shows the card error and does not complete the order", async () => {
    confirmPayment.mockResolvedValue({ error: { message: "Your card was declined." } });
    await openPaymentForm();

    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Card payment" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Your card was declined.");
    expect(completeSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: PAY })).toBeEnabled();
  });

  it("offers to start over when the merchant rejects the payment", async () => {
    confirmPayment.mockResolvedValue({
      paymentIntent: { id: "pi_123", status: "requires_capture" },
    });
    const { CheckoutError } = await import("@/lib/commerce/checkout");
    vi.mocked(completeSession).mockRejectedValue(new CheckoutError("Seats sold out."));
    await openPaymentForm();

    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "Card payment" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Seats sold out.");
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByRole("button", { name: PAY })).toBeInTheDocument();
    expect(cartStore.getSnapshot().items).toHaveLength(1);
  });

  it("surfaces PaymentIntent creation failures", async () => {
    vi.mocked(createPaymentIntent).mockRejectedValue(new Error("boom"));
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: PAY }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("We couldn't complete the payment")
    );
    expect(screen.queryByTestId("payment-element")).not.toBeInTheDocument();
  });

  it("is inactive once the bag is empty", () => {
    cartStore.clear();
    renderPanel();
    expect(screen.getByText(/no longer active/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
