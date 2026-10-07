import { NextResponse, type NextRequest } from "next/server";

import { callMcpTool } from "@/lib/commerce/mcp";
import { readCappedText, validateMcpToolCall } from "@/lib/commerce/mcp-protocol";
import { isCrossOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Allow-listed MCP `tools/call` passthrough (recommendations and click attribution). */
export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) return json(403, { error: "Forbidden" });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(415, { error: "Expected application/json" });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json(413, { error: "Payload too large" });
  }

  let raw: string | null;
  try {
    raw = await readCappedText(request.body, MAX_BODY_BYTES);
  } catch {
    return json(400, { error: "Invalid body" });
  }
  if (raw === null) return json(413, { error: "Payload too large" });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const call = validateMcpToolCall(body);
  if (!call.ok) return json(400, { error: call.error });

  try {
    const result = await callMcpTool(call.name, call.arguments);
    return json(200, { result: result.structuredContent, isError: result.isError });
  } catch {
    return json(502, { error: "Recommendations are unavailable right now" });
  }
}
