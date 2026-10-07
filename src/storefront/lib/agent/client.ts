import "server-only";
// Use the platform fetch (Node 18+) instead of the SDK's node-fetch shim.
import "openai/shims/web";

import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import { createResponsesClient } from "@/lib/agent/responses-client";
import { getLlmConfig, type LlmConfig } from "@/lib/env";

export type LlmMessage = ChatCompletionMessageParam;

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type LlmStreamEvent =
  { type: "text"; delta: string } | { type: "tool_calls"; calls: LlmToolCall[] };

export interface LlmStepRequest {
  messages: LlmMessage[];
  tools: ChatCompletionTool[];
  toolChoice: "auto" | "none";
  signal?: AbortSignal;
}

export interface LlmClient {
  streamStep(request: LlmStepRequest): AsyncGenerator<LlmStreamEvent, void, undefined>;
}

export type LlmErrorCode = "timeout" | "aborted" | "http" | "network";

/** Carries only a code and status; upstream messages are dropped so nothing sensitive leaks. */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    readonly status?: number
  ) {
    super(status ? `LLM request failed (${code} ${status})` : `LLM request failed (${code})`);
    this.name = "LlmError";
  }
}

const TEMPERATURE = 0.3;
const MAX_TOKENS = 600;
export const MAX_TOOL_CALLS_PER_STEP = 3;
export const MAX_TOOL_ARGUMENT_CHARS = 4000;

type NimStreamingParams = ChatCompletionCreateParamsStreaming & {
  chat_template_kwargs: { enable_thinking: boolean };
};

function toLlmError(error: unknown, callerSignal: AbortSignal | undefined): LlmError {
  if (error instanceof LlmError) return error;
  if (callerSignal?.aborted) return new LlmError("aborted");
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new LlmError("timeout");
  if (error instanceof OpenAI.APIUserAbortError) return new LlmError("timeout");
  if (error instanceof OpenAI.APIError && typeof error.status === "number") {
    return new LlmError("http", error.status);
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new LlmError("timeout");
  }
  return new LlmError("network");
}

/** Returns null when no API key is configured (deterministic router only). */
export function createLlmClient(config: LlmConfig = getLlmConfig()): LlmClient | null {
  const { apiKey } = config;
  if (!apiKey) return null;
  if (config.provider === "responses") return createResponsesClient({ ...config, apiKey });

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: 0,
    fetch: (url, init) => globalThis.fetch(url, init),
  });

  async function* streamStep(
    request: LlmStepRequest
  ): AsyncGenerator<LlmStreamEvent, void, undefined> {
    const deadline = AbortSignal.timeout(config.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
    const params: NimStreamingParams = {
      model: config.model,
      messages: request.messages,
      tools: request.tools,
      tool_choice: request.toolChoice,
      parallel_tool_calls: false,
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
    };

    const calls = new Map<number, LlmToolCall>();
    try {
      const stream = await client.chat.completions.create(params, { signal });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { type: "text", delta: delta.content };
        }
        for (const part of delta.tool_calls ?? []) {
          const existing = calls.get(part.index);
          if (!existing && calls.size >= MAX_TOOL_CALLS_PER_STEP) continue;
          const call = existing ?? { id: "", name: "", arguments: "" };
          if (part.id) call.id = part.id;
          if (part.function?.name) call.name += part.function.name;
          if (part.function?.arguments && call.arguments.length < MAX_TOOL_ARGUMENT_CHARS) {
            call.arguments += part.function.arguments;
          }
          calls.set(part.index, call);
        }
      }
    } catch (error) {
      throw toLlmError(error, request.signal);
    }

    if (calls.size > 0) {
      yield {
        type: "tool_calls",
        calls: [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` })),
      };
    }
  }

  return { streamStep };
}
