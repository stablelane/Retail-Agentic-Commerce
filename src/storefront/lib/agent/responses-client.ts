import "server-only";

import type { ChatCompletionTool } from "openai/resources/chat/completions";

import {
  LlmError,
  MAX_TOOL_ARGUMENT_CHARS,
  MAX_TOOL_CALLS_PER_STEP,
  type LlmClient,
  type LlmMessage,
  type LlmStepRequest,
  type LlmStreamEvent,
  type LlmToolCall,
} from "@/lib/agent/client";
import type { LlmConfig } from "@/lib/env";

// Reasoning tokens count toward this cap, so it is far above the visible reply length.
const MAX_OUTPUT_TOKENS = 4000;
const MAX_SSE_BUFFER_CHARS = 1_000_000;

type ResponsesInputItem =
  | { role: "user" | "assistant" | "developer"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: false;
}

export interface ResponsesRequestBody {
  model: string;
  instructions?: string;
  input: ResponsesInputItem[];
  tools: ResponsesFunctionTool[];
  tool_choice: "auto" | "none";
  parallel_tool_calls: false;
  max_output_tokens: number;
  reasoning: { effort: string };
  store: false;
  stream: true;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("");
}

/** Translate chat-completions style history into a Responses API request body. */
export function buildResponsesRequest(
  config: Pick<LlmConfig, "model" | "reasoningEffort">,
  request: Pick<LlmStepRequest, "messages" | "tools" | "toolChoice">
): ResponsesRequestBody {
  const instructions: string[] = [];
  const input: ResponsesInputItem[] = [];

  for (const message of request.messages as LlmMessage[]) {
    switch (message.role) {
      case "system":
      case "developer":
        instructions.push(textOf(message.content));
        break;
      case "user":
        input.push({ role: "user", content: textOf(message.content) });
        break;
      case "assistant": {
        const text = textOf(message.content);
        if (text) input.push({ role: "assistant", content: text });
        for (const call of message.tool_calls ?? []) {
          if (call.type !== "function") continue;
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
        }
        break;
      }
      case "tool":
        input.push({
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: textOf(message.content),
        });
        break;
      default:
        break;
    }
  }

  const body: ResponsesRequestBody = {
    model: config.model,
    input,
    tools: request.tools.map((tool: ChatCompletionTool) => ({
      type: "function",
      name: tool.function.name,
      ...(tool.function.description ? { description: tool.function.description } : {}),
      parameters: (tool.function.parameters ?? { type: "object", properties: {} }) as Record<
        string,
        unknown
      >,
      strict: false,
    })),
    tool_choice: request.toolChoice,
    parallel_tool_calls: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: config.reasoningEffort },
    store: false,
    stream: true,
  };
  const joined = instructions.filter(Boolean).join("\n\n");
  if (joined) body.instructions = joined;
  return body;
}

/** Azure endpoints authenticate with `api-key`; everything else uses a bearer token. */
export function authHeaders(baseUrl: string, apiKey: string): Record<string, string> {
  const host = new URL(baseUrl).hostname;
  return host.endsWith(".azure.com")
    ? { "api-key": apiKey }
    : { authorization: `Bearer ${apiKey}` };
}

/** Accepts either the API root (`…/openai/v1`) or the full `…/responses` URL. */
export function responsesUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/responses$/, "") + "/responses";
  url.search = "";
  return url.toString();
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_BUFFER_CHARS) throw new LlmError("http");
      const frames = buffer.replace(/\r\n/g, "\n").split("\n\n");
      buffer = done ? "" : (frames.pop() ?? "");
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") yield data;
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

interface StreamEvent {
  type?: unknown;
  delta?: unknown;
  item?: { type?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown };
}

/** OpenAI Responses API client (e.g. Azure AI Foundry `gpt-5.x` deployments). */
export function createResponsesClient(config: LlmConfig & { apiKey: string }): LlmClient {
  const url = responsesUrl(config.baseUrl);
  const headers = {
    "content-type": "application/json",
    accept: "text/event-stream",
    ...authHeaders(config.baseUrl, config.apiKey),
  };

  async function* streamStep(
    request: LlmStepRequest
  ): AsyncGenerator<LlmStreamEvent, void, undefined> {
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
    const calls: LlmToolCall[] = [];

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(buildResponsesRequest(config, request)),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new LlmError("http", response.status);
      }

      for await (const data of readSseData(response.body)) {
        let event: StreamEvent;
        try {
          event = JSON.parse(data) as StreamEvent;
        } catch {
          continue;
        }
        switch (event.type) {
          case "response.output_text.delta":
            if (typeof event.delta === "string" && event.delta) {
              yield { type: "text", delta: event.delta };
            }
            break;
          case "response.output_item.done": {
            const item = event.item;
            if (item?.type !== "function_call" || calls.length >= MAX_TOOL_CALLS_PER_STEP) break;
            calls.push({
              id: typeof item.call_id === "string" ? item.call_id : `call_${calls.length}`,
              name: typeof item.name === "string" ? item.name : "",
              arguments:
                typeof item.arguments === "string"
                  ? item.arguments.slice(0, MAX_TOOL_ARGUMENT_CHARS)
                  : "",
            });
            break;
          }
          case "response.failed":
          case "error":
            throw new LlmError("http");
          default:
            break;
        }
      }
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (request.signal?.aborted) throw new LlmError("aborted");
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new LlmError("timeout");
      }
      throw new LlmError("network");
    }

    if (calls.length > 0) yield { type: "tool_calls", calls };
  }

  return { streamStep };
}
