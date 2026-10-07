/**
 * Path allow-lists for the server-side proxies. Each rule matches an exact number of
 * path segments; literals must match exactly and ids must match an anchored pattern,
 * so traversal (`..`), encoded slashes, schemes and unknown endpoints are rejected.
 */

export type ProxyMethod = "GET" | "POST";

export interface ProxyRule {
  method: ProxyMethod;
  path: readonly (string | RegExp)[];
  /** Query parameter names forwarded upstream; everything else is dropped. */
  query?: readonly string[];
}

export type ProxyMatch =
  | { ok: true; path: string; query: URLSearchParams }
  | { ok: false; status: 404 | 405; allow?: ProxyMethod[] };

export const PRODUCT_ID = /^prod_[a-z0-9_]{1,64}$/;
export const CHECKOUT_SESSION_ID = /^checkout_[A-Za-z0-9_-]{1,64}$/;
export const ORDER_ID = /^order_[A-Za-z0-9_-]{1,64}$/;

const MAX_QUERY_VALUE_LENGTH = 256;

export const MERCHANT_PROXY_RULES: readonly ProxyRule[] = [
  { method: "GET", path: ["products"], query: ["category", "limit", "offset"] },
  { method: "GET", path: ["products", PRODUCT_ID] },
  { method: "POST", path: ["checkout_sessions"] },
  { method: "GET", path: ["checkout_sessions", CHECKOUT_SESSION_ID] },
  { method: "POST", path: ["checkout_sessions", CHECKOUT_SESSION_ID] },
  { method: "POST", path: ["checkout_sessions", CHECKOUT_SESSION_ID, "complete"] },
  { method: "POST", path: ["checkout_sessions", CHECKOUT_SESSION_ID, "cancel"] },
  { method: "GET", path: ["orders", ORDER_ID], query: ["email"] },
];

export const PSP_PROXY_RULES: readonly ProxyRule[] = [
  { method: "POST", path: ["agentic_commerce", "delegate_payment"] },
];

function segmentsMatch(
  pattern: readonly (string | RegExp)[],
  segments: readonly string[]
): boolean {
  if (pattern.length !== segments.length) return false;
  return pattern.every((matcher, index) => {
    const segment = segments[index] ?? "";
    return typeof matcher === "string" ? matcher === segment : matcher.test(segment);
  });
}

export function matchProxyRequest(
  rules: readonly ProxyRule[],
  method: string,
  segments: readonly string[],
  search: URLSearchParams
): ProxyMatch {
  const pathMatches = rules.filter((rule) => segmentsMatch(rule.path, segments));
  if (pathMatches.length === 0) return { ok: false, status: 404 };

  const rule = pathMatches.find((candidate) => candidate.method === method.toUpperCase());
  if (!rule) {
    return { ok: false, status: 405, allow: pathMatches.map((candidate) => candidate.method) };
  }

  const query = new URLSearchParams();
  for (const name of rule.query ?? []) {
    const value = search.get(name);
    if (value !== null && value.length <= MAX_QUERY_VALUE_LENGTH) query.set(name, value);
  }

  return { ok: true, path: "/" + segments.map(encodeURIComponent).join("/"), query };
}
