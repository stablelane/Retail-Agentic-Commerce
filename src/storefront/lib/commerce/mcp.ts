import "server-only";

import {
  parseMcpResponse,
  readCappedText,
  type McpServerToolName,
  type McpToolResult,
} from "@/lib/commerce/mcp-protocol";
import { getMcpServerUrl } from "@/lib/env";

/** Search and recommendation agents are LLM-backed and slow; clicks should be near-instant. */
const TOOL_TIMEOUT_MS: Record<McpServerToolName, number> = {
  "search-products": 60_000,
  "get-recommendations": 90_000,
  "track-recommendation-click": 5_000,
};

const MAX_RESPONSE_BYTES = 256 * 1024;

export class McpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpUnavailableError";
  }
}

let requestId = 0;

/** POST a JSON-RPC `tools/call` to the Apps SDK MCP server (`{MCP_SERVER_URL}/api/mcp`). */
export async function callMcpTool(
  name: McpServerToolName,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<McpToolResult> {
  const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS[name]);
  const url = new URL(getMcpServerUrl());
  url.pathname = url.pathname.replace(/\/+$/, "") + "/api/mcp";
  requestId += 1;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      cache: "no-store",
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new McpUnavailableError("MCP server is unreachable");
  }

  if (!response.ok) throw new McpUnavailableError(`MCP server responded with ${response.status}`);
  let body: string | null;
  try {
    body = await readCappedText(response.body, MAX_RESPONSE_BYTES);
  } catch {
    throw new McpUnavailableError("MCP response was interrupted");
  }
  if (body === null) throw new McpUnavailableError("MCP response too large");
  return parseMcpResponse(body, response.headers.get("content-type"));
}
