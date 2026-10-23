// @vitest-environment node
import { NextRequest } from "next/server";

import { POST } from "@/app/api/stripe/payment-intent/route";
import { getCheckoutSession } from "@/lib/commerce/merchant";

vi.mock("server-only", () => ({}));

const create = vi.fn();

vi.mock("stripe", () => ({
  default: vi.fn(function Stripe() {
    return { paymentIntents: { create } };
  }),
}));

vi.mock("@/lib/commerce/merchant", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/commerce/merchant")>()),
  getCheckoutSession: vi.fn(),
}));

const ROUTE_URL = "http://localhost:3002/api/stripe/payment-intent";
let ip = 0;

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  ip += 1;
  return new NextRequest(ROUTE_URL, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "localhost:3002",
      "idempotency-key": "pi_abcdef123456",
      "x-forwarded-for": `10.0.0.${ip}`,
      ...headers,
    },
  });
}

const READY = {
  id: "checkout_abc123",
  status: "ready_for_payment",
  currency: "AED",
  totals: [{ type: "total", display_text: "Total", amount: 35000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
  vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_123");
  vi.mocked(getCheckoutSession).mockResolvedValue(READY as never);
  create.mockResolvedValue({ id: "pi_1", client_secret: "pi_1_secret_2" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/stripe/payment-intent", () => {
  it("creates a manual-capture intent for the merchant total", async () => {
    const response = await POST(request({ checkoutSessionId: "checkout_abc123" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientSecret: "pi_1_secret_2",
      publishableKey: "pk_test_123",
      paymentIntentId: "pi_1",
      amount: 35000,
      currency: "AED",
    });
    expect(create).toHaveBeenCalledWith(
      {
        amount: 35000,
        currency: "aed",
        capture_method: "manual",
        allowed_payment_method_types: ["card"],
        metadata: { checkout_session_id: "checkout_abc123" },
      },
      { idempotencyKey: "pi_abcdef123456" }
    );
  });

  it("is unavailable without Stripe keys", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const response = await POST(request({ checkoutSessionId: "checkout_abc123" }));
    expect(response.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    [{ checkoutSessionId: "../orders" }, {}],
    [{ checkoutSessionId: 42 }, {}],
    [{ checkoutSessionId: "checkout_abc123" }, { "idempotency-key": "" }],
  ])("rejects invalid input %j", async (body, headers) => {
    const response = await POST(request(body, headers));
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests", async () => {
    const response = await POST(
      request({ checkoutSessionId: "checkout_abc123" }, { origin: "https://evil.example" })
    );
    expect(response.status).toBe(403);
  });

  it("refuses sessions that are not ready for payment", async () => {
    vi.mocked(getCheckoutSession).mockResolvedValue({
      ...READY,
      status: "not_ready_for_payment",
    } as never);
    const response = await POST(request({ checkoutSessionId: "checkout_abc123" }));
    expect(response.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown sessions", async () => {
    vi.mocked(getCheckoutSession).mockResolvedValue(null);
    const response = await POST(request({ checkoutSessionId: "checkout_abc123" }));
    expect(response.status).toBe(404);
  });

  it("hides Stripe error details from the browser", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    create.mockRejectedValue(new Error("Invalid API Key provided: sk_test_****123"));
    const response = await POST(request({ checkoutSessionId: "checkout_abc123" }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("sk_test");
  });
});
