// @vitest-environment node
import { NextRequest } from "next/server";

import { POST } from "@/app/api/mcp-proxy/route";

vi.mock("server-only", () => ({}));

const MCP_URL = "http://mcp.test:2091";
const ORIGIN = "http://localhost:3002";

const RECOMMENDATIONS = {
  recommendations: [
    { productId: "prod_2", productName: "Slim Jeans", rank: 1, reasoning: "Pairs" },
  ],
  recommendationRequestId: "rec_f94513d946e4",
};

const fetchMock = vi.fn<typeof fetch>();

function rpcResult(structuredContent: unknown, isError = false) {
  return { jsonrpc: "2.0", id: 1, result: { content: [], structuredContent, isError } };
}

function sse(payload: unknown): Response {
  return new Response(`: ping\n\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/api/mcp-proxy`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      host: "localhost:3002",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const recommendationCall = {
  name: "get-recommendations",
  arguments: { productId: "prod_1", productName: "Classic Tee", cartItems: [] },
};

function upstreamCall(index = 0) {
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  return {
    url: String(url),
    init,
    body: JSON.parse(String(init?.body)) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("MCP_SERVER_URL", MCP_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/mcp-proxy", () => {
  it("forwards get-recommendations as a JSON-RPC tools/call and unwraps SSE", async () => {
    fetchMock.mockResolvedValue(sse(rpcResult(RECOMMENDATIONS)));

    const response = await POST(request(recommendationCall));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ result: RECOMMENDATIONS, isError: false });

    const { url, init, body } = upstreamCall();
    expect(url).toBe(`${MCP_URL}/api/mcp`);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("accept")).toBe("application/json, text/event-stream");
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "get-recommendations",
        arguments: {
          productId: "prod_1",
          productName: "Classic Tee",
          cartItems: [],
          sessionId: null,
        },
      },
    });
  });

  it("handles plain JSON responses", async () => {
    fetchMock.mockResolvedValue(Response.json(rpcResult({ recorded: true })));

    const response = await POST(
      request({
        name: "track-recommendation-click",
        arguments: {
          productId: "prod_2",
          recommendationRequestId: "rec_f94513d946e4",
          position: 1,
          source: "storefront_pdp",
        },
      })
    );

    await expect(response.json()).resolves.toEqual({ result: { recorded: true }, isError: false });
    expect(upstreamCall().body.params.name).toBe("track-recommendation-click");
  });

  it("never forwards caller-supplied URLs or extra arguments", async () => {
    fetchMock.mockResolvedValue(sse(rpcResult(RECOMMENDATIONS)));

    await POST(
      request({
        ...recommendationCall,
        url: "http://evil.example/api/mcp",
        arguments: { ...recommendationCall.arguments, url: "http://evil.example", jsonrpc: "x" },
      })
    );

    const { url, body } = upstreamCall();
    expect(url).toBe(`${MCP_URL}/api/mcp`);
    expect(Object.keys(body.params.arguments).sort()).toEqual([
      "cartItems",
      "productId",
      "productName",
      "sessionId",
    ]);
  });

  it.each(["checkout", "create-checkout-session", "search-products"])(
    "rejects the disallowed tool %s without calling upstream",
    async (name) => {
      const response = await POST(request({ name, arguments: {} }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Tool not allowed" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each(["prod_1/../../admin", "PROD_1", "http://evil.example"])(
    "rejects product id %s",
    async (productId) => {
      const response = await POST(
        request({
          ...recommendationCall,
          arguments: { ...recommendationCall.arguments, productId },
        })
      );
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("rejects cross-origin requests", async () => {
    const response = await POST(request(recommendationCall, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a JSON content type", async () => {
    const response = await POST(request(recommendationCall, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("rejects invalid JSON", async () => {
    const response = await POST(request("{nope"));
    expect(response.status).toBe(400);
  });

  it("caps the body size", async () => {
    const huge = { ...recommendationCall, padding: "x".repeat(20 * 1024) };
    const response = await POST(request(huge));
    expect(response.status).toBe(413);

    const declared = await POST(request(recommendationCall, { "content-length": "999999" }));
    expect(declared.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
    ["HTTP 500", () => Promise.resolve(new Response("oops", { status: 500 }))],
    [
      "JSON-RPC error",
      () =>
        Promise.resolve(
          sse({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params" } })
        ),
    ],
    ["stream without result", () => Promise.resolve(sse({ jsonrpc: "2.0", method: "ping" }))],
  ])("maps an upstream failure (%s) to 502", async (_label, reply) => {
    fetchMock.mockImplementation(reply);
    const response = await POST(request(recommendationCall));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Recommendations are unavailable right now",
    });
  });

  it("rejects oversized upstream responses", async () => {
    fetchMock.mockResolvedValue(
      new Response("x".repeat(300 * 1024), { headers: { "content-type": "application/json" } })
    );
    const response = await POST(request(recommendationCall));
    expect(response.status).toBe(502);
  });
});
