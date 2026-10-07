import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { matchProxyRequest, type ProxyRule } from "@/lib/commerce/proxy-allowlist";
import type { UpstreamConfig } from "@/lib/env";

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "api-version",
  "content-type",
  "idempotency-key",
  "request-id",
] as const;
const FORWARD_RESPONSE_HEADERS = ["content-type", "idempotency-key", "request-id"] as const;
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

interface ProxyOptions {
  upstream: UpstreamConfig;
  rules: readonly ProxyRule[];
  /** Env var name reported when the key is missing. */
  keyName: string;
}

function jsonError(status: number, message: string, headers?: HeadersInit): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { "cache-control": "no-store", ...headers } }
  );
}

/** Forward an allow-listed request upstream with the server-side API key attached. */
export async function forwardToUpstream(
  request: NextRequest,
  segments: readonly string[],
  { upstream, rules, keyName }: ProxyOptions
): Promise<NextResponse> {
  const match = matchProxyRequest(rules, request.method, segments, request.nextUrl.searchParams);
  if (!match.ok) {
    return match.status === 405
      ? jsonError(405, "Method not allowed", { allow: (match.allow ?? []).join(", ") })
      : jsonError(404, "Not found");
  }

  if (!upstream.apiKey) {
    return jsonError(500, `Proxy misconfigured: ${keyName} not set`);
  }

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${upstream.apiKey}`);

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return jsonError(413, "Payload too large");
  }

  const url = new URL(upstream.baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + match.path;
  url.search = match.query.toString();

  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers,
      body: body ?? null,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return jsonError(502, "Upstream request failed");
  }

  if (response.status >= 300 && response.status < 400) {
    return jsonError(502, "Unexpected upstream redirect");
  }

  const responseHeaders = new Headers({ "cache-control": "no-store" });
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    headers: responseHeaders,
  });
}
