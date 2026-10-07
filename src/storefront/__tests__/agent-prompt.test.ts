import { buildSystemPrompt } from "@/lib/agent/prompt";
import { clientKey, createRateLimiter } from "@/lib/agent/rate-limit";
import { MOCK_USER } from "@/lib/commerce/user";

vi.mock("server-only", () => ({}));

describe("createRateLimiter", () => {
  it("allows `limit` requests per window per key", () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 10)).toBe(true);
    expect(limiter.take("a", 20)).toBe(false);
    expect(limiter.take("b", 20)).toBe(true);
    expect(limiter.take("a", 1000)).toBe(true);
  });

  it("derives a bounded client key", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers())).toBe("unknown");
    expect(clientKey(new Headers({ "x-real-ip": "x".repeat(200) }))).toHaveLength(64);
  });
});

describe("buildSystemPrompt", () => {
  it("includes brand, customer, page, bag and locale", () => {
    const prompt = buildSystemPrompt({
      brandName: "Matter",
      user: MOCK_USER,
      context: { page: "pdp", productId: "prod_3" },
      cart: { sessionId: "checkout_1", items: [{ id: "prod_1", quantity: 2 }] },
      locale: "fr",
    });
    expect(prompt).toContain("shopping assistant for Matter");
    expect(prompt).toContain("John Doe (john@example.com), Gold member, 1250 points");
    expect(prompt).toContain("Current page: pdp, viewing product prod_3.");
    expect(prompt).toContain("Bag: 2 items (prod_1 x2), checkout_1.");
    expect(prompt).toContain("Respond in French");
    expect(prompt).toContain("Never invent products");
  });

  it("describes an empty bag", () => {
    const prompt = buildSystemPrompt({
      brandName: "Matter",
      user: MOCK_USER,
      context: { page: "home" },
      cart: { sessionId: null, items: [] },
      locale: "en",
    });
    expect(prompt).toContain("Bag: empty, no session.");
  });
});
