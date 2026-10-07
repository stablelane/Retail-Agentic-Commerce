// @vitest-environment node
import {
  McpProtocolError,
  normalizeRecommendations,
  parseMcpResponse,
  readCappedText,
  validateMcpToolCall,
} from "@/lib/commerce/mcp-protocol";

const RESULT = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    content: [{ type: "text", text: "Found 2 recommendations" }],
    structuredContent: {
      recommendations: [{ productId: "prod_2", productName: "Slim Jeans", rank: 1 }],
      recommendationRequestId: "rec_f94513d946e4",
    },
    isError: false,
  },
};

describe("validateMcpToolCall", () => {
  it("accepts get-recommendations and keeps only known arguments", () => {
    const call = validateMcpToolCall({
      name: "get-recommendations",
      arguments: {
        productId: "prod_1",
        productName: "Classic Tee",
        cartItems: [{ productId: "prod_2", name: "Slim Jeans", price: 6000, extra: "x" }],
        url: "http://evil.example",
      },
    });
    expect(call).toEqual({
      ok: true,
      name: "get-recommendations",
      arguments: {
        productId: "prod_1",
        productName: "Classic Tee",
        cartItems: [{ productId: "prod_2", name: "Slim Jeans", price: 6000 }],
        sessionId: null,
      },
    });
  });

  it("accepts track-recommendation-click", () => {
    expect(
      validateMcpToolCall({
        name: "track-recommendation-click",
        arguments: {
          productId: "prod_2",
          recommendationRequestId: "rec_abc123",
          sessionId: "checkout_abc",
          position: 2,
          source: "storefront_pdp",
        },
      })
    ).toEqual({
      ok: true,
      name: "track-recommendation-click",
      arguments: {
        productId: "prod_2",
        recommendationRequestId: "rec_abc123",
        sessionId: "checkout_abc",
        position: 2,
        source: "storefront_pdp",
      },
    });
  });

  it.each(["checkout", "create-checkout-session", "search-products", "tools/list", "", 42])(
    "rejects tool %j",
    (name) => {
      expect(validateMcpToolCall({ name, arguments: {} })).toEqual({
        ok: false,
        error: "Tool not allowed",
      });
    }
  );

  it.each([null, [], "get-recommendations", { name: "get-recommendations" }])(
    "rejects malformed body %j",
    (body) => {
      expect(validateMcpToolCall(body)).toMatchObject({ ok: false });
    }
  );

  it.each([
    "PROD_1",
    "prod_",
    "prod_1/../admin",
    "prod_1?x=1",
    "https://evil.example",
    `prod_${"a".repeat(65)}`,
    7,
  ])("rejects product id %j", (productId) => {
    expect(
      validateMcpToolCall({
        name: "get-recommendations",
        arguments: { productId, productName: "Tee" },
      })
    ).toEqual({ ok: false, error: "Invalid productId" });
  });

  it.each([
    [{ productName: "" }, "Invalid productName"],
    [{ productName: "x".repeat(201) }, "Invalid productName"],
    [{ cartItems: "prod_2" }, "Invalid cartItems"],
    [{ cartItems: [{ productId: "bad", name: "x", price: 1 }] }, "Invalid cartItems"],
    [{ cartItems: [{ productId: "prod_2", name: "x", price: 1.5 }] }, "Invalid cartItems"],
    [
      { cartItems: Array(51).fill({ productId: "prod_2", name: "x", price: 1 }) },
      "Invalid cartItems",
    ],
    [{ sessionId: "../checkout" }, "Invalid sessionId"],
  ])("rejects invalid recommendation args %j", (override, error) => {
    expect(
      validateMcpToolCall({
        name: "get-recommendations",
        arguments: { productId: "prod_1", productName: "Tee", ...override },
      })
    ).toEqual({ ok: false, error });
  });

  it.each([
    [{ recommendationRequestId: "req_1" }, "Invalid recommendationRequestId"],
    [{ position: 0 }, "Invalid position"],
    [{ position: 51 }, "Invalid position"],
    [{ source: "apps_sdk_widget" }, "Invalid source"],
    [{ productId: "prod_X" }, "Invalid productId"],
  ])("rejects invalid click args %j", (override, error) => {
    expect(
      validateMcpToolCall({
        name: "track-recommendation-click",
        arguments: {
          productId: "prod_2",
          recommendationRequestId: "rec_abc",
          source: "storefront_pdp",
          ...override,
        },
      })
    ).toEqual({ ok: false, error });
  });
});

describe("parseMcpResponse", () => {
  it("parses a plain JSON response", () => {
    expect(parseMcpResponse(JSON.stringify(RESULT), "application/json")).toEqual({
      structuredContent: RESULT.result.structuredContent,
      isError: false,
    });
  });

  it("parses an SSE response with keep-alive comments and an event name", () => {
    const body = [
      ": ping - 2026-10-07 16:32:52",
      "",
      ": ping - 2026-10-07 16:33:07",
      "",
      "event: message",
      `data: ${JSON.stringify(RESULT)}`,
      "",
      "",
    ].join("\r\n");
    expect(parseMcpResponse(body, "text/event-stream; charset=utf-8").structuredContent).toEqual(
      RESULT.result.structuredContent
    );
  });

  it("joins multi-line SSE data fields", () => {
    const pretty = JSON.stringify(RESULT, null, 2)
      .split("\n")
      .map((line) => `data: ${line}`)
      .join("\n");
    expect(parseMcpResponse(`event: message\n${pretty}\n\n`, "text/event-stream")).toMatchObject({
      isError: false,
    });
  });

  it("skips notifications and uses the response message", () => {
    const notification = { jsonrpc: "2.0", method: "notifications/progress", params: {} };
    const body = `data: ${JSON.stringify(notification)}\n\ndata: ${JSON.stringify(RESULT)}\n\n`;
    expect(parseMcpResponse(body, "text/event-stream").structuredContent).not.toBeNull();
  });

  it("reports tool-level errors without throwing", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "boom" }], isError: true },
    });
    expect(parseMcpResponse(body, "application/json")).toEqual({
      structuredContent: null,
      isError: true,
    });
  });

  it("throws on JSON-RPC errors", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Bad" } });
    expect(() => parseMcpResponse(body, "application/json")).toThrow(new McpProtocolError("Bad"));
    expect(() => parseMcpResponse(`data: ${body}\n\n`, "text/event-stream")).toThrow("Bad");
  });

  it.each([
    ["not json", "application/json", "MCP response is not valid JSON"],
    ["[]", "application/json", "Malformed MCP response"],
    ['{"jsonrpc":"2.0","id":1}', "application/json", "MCP response has no result"],
    [": ping\n\n", "text/event-stream", "MCP stream ended without a result"],
    ["data: {oops\n\n", "text/event-stream", "MCP stream ended without a result"],
  ])("rejects %j (%s)", (body, contentType, message) => {
    expect(() => parseMcpResponse(body, contentType)).toThrow(message);
  });
});

describe("normalizeRecommendations", () => {
  it("accepts either key casing, dedupes, drops invalid ids and sorts by rank", () => {
    expect(
      normalizeRecommendations(
        {
          recommendationRequestId: "rec_abc",
          recommendations: [
            { product_id: "prod_3", product_name: "Cap", rank: 2, reasoning: "Pairs well" },
            { productId: "prod_2", productName: "Jeans", rank: 1 },
            { productId: "prod_2", productName: "Dup", rank: 3 },
            { productId: "javascript:alert(1)", rank: 4 },
            "prod_9",
          ],
        },
        6
      )
    ).toEqual({
      recommendationRequestId: "rec_abc",
      recommendations: [
        { productId: "prod_2", productName: "Jeans", rank: 1, reasoning: "" },
        { productId: "prod_3", productName: "Cap", rank: 2, reasoning: "Pairs well" },
      ],
    });
  });

  it("returns an empty set for missing or malformed content", () => {
    const empty = { recommendationRequestId: null, recommendations: [] };
    expect(normalizeRecommendations(null)).toEqual(empty);
    expect(
      normalizeRecommendations({ recommendations: "nope", recommendationRequestId: 5 })
    ).toEqual(empty);
  });

  it("applies the limit", () => {
    const recommendations = Array.from({ length: 8 }, (_, i) => ({ productId: `prod_${i + 1}` }));
    expect(normalizeRecommendations({ recommendations }, 6).recommendations).toHaveLength(6);
  });
});

describe("readCappedText", () => {
  function stream(...chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    });
  }

  it("concatenates chunks, including split multi-byte characters", async () => {
    const bytes = new TextEncoder().encode("caf\u00e9");
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4));
        controller.enqueue(bytes.slice(4));
        controller.close();
      },
    });
    await expect(readCappedText(split, 100)).resolves.toBe("caf\u00e9");
    await expect(readCappedText(stream("ab", "cd"), 4)).resolves.toBe("abcd");
  });

  it("returns null once the byte limit is exceeded", async () => {
    await expect(readCappedText(stream("ab", "cde"), 4)).resolves.toBeNull();
    // Counts bytes, not characters.
    await expect(readCappedText(stream("\u00e9\u00e9\u00e9"), 5)).resolves.toBeNull();
  });

  it("treats a missing body as empty", async () => {
    await expect(readCappedText(null, 10)).resolves.toBe("");
  });
});
