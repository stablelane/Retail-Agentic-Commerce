import {
  MERCHANT_PROXY_RULES,
  PSP_PROXY_RULES,
  matchProxyRequest,
} from "@/lib/commerce/proxy-allowlist";

const noQuery = new URLSearchParams();

function merchant(method: string, path: string, search = noQuery) {
  return matchProxyRequest(MERCHANT_PROXY_RULES, method, path.split("/"), search);
}

describe("merchant proxy allow-list", () => {
  it.each([
    ["GET", "products"],
    ["GET", "products/prod_3"],
    ["POST", "checkout_sessions"],
    ["GET", "checkout_sessions/checkout_abc123def456"],
    ["POST", "checkout_sessions/checkout_abc123def456"],
    ["POST", "checkout_sessions/checkout_abc123def456/complete"],
    ["POST", "checkout_sessions/checkout_abc123def456/cancel"],
    ["GET", "orders/order_abc123def456"],
  ])("allows %s /%s", (method, path) => {
    const result = merchant(method, path);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(`/${path}`);
  });

  it.each([
    "metrics",
    "health",
    "products/prod_3/extra",
    "products/..",
    "products/prod_3%2F..",
    "products/http:",
    "products/PROD_3",
    "checkout_sessions/not_a_session",
    "orders/..%2Fproducts",
    "",
  ])("rejects /%s with 404", (path) => {
    expect(merchant("GET", path)).toEqual({ ok: false, status: 404 });
  });

  it("rejects disallowed methods with 405 and an Allow list", () => {
    expect(merchant("DELETE", "products")).toEqual({ ok: false, status: 405, allow: ["GET"] });
    expect(merchant("POST", "orders/order_abc")).toEqual({
      ok: false,
      status: 405,
      allow: ["GET"],
    });
  });

  it("forwards only allow-listed query parameters", () => {
    const result = merchant(
      "GET",
      "products",
      new URLSearchParams("category=tops&limit=5&url=http://evil.example")
    );
    expect(result.ok && result.query.toString()).toBe("category=tops&limit=5");

    const order = merchant("GET", "orders/order_abc", new URLSearchParams("email=a@b.c&x=1"));
    expect(order.ok && order.query.toString()).toBe("email=a%40b.c");
  });

  it("drops oversized query values", () => {
    const result = merchant("GET", "products", new URLSearchParams({ category: "x".repeat(300) }));
    expect(result.ok && result.query.toString()).toBe("");
  });
});

describe("psp proxy allow-list", () => {
  it("allows only POST delegate_payment", () => {
    const segments = ["agentic_commerce", "delegate_payment"];
    expect(matchProxyRequest(PSP_PROXY_RULES, "POST", segments, noQuery).ok).toBe(true);
    expect(matchProxyRequest(PSP_PROXY_RULES, "GET", segments, noQuery)).toMatchObject({
      status: 405,
    });
    expect(matchProxyRequest(PSP_PROXY_RULES, "POST", ["vault"], noQuery)).toMatchObject({
      status: 404,
    });
  });
});
