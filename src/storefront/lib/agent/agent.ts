import "server-only";

import { LlmError, type LlmClient, type LlmMessage } from "@/lib/agent/client";
import type { ToolExecutor, ToolOutcome } from "@/lib/agent/executor";
import { createExecutorContext } from "@/lib/agent/executor";
import { FOLLOW_UP_SUGGESTIONS, getChatIntent, intentFromText } from "@/lib/agent/intents";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { routeIntent, routeMessage, type RoutedTurn } from "@/lib/agent/router";
import { TOOL_DEFINITIONS, TOOL_LABELS, isToolName, type ToolName } from "@/lib/agent/tools";
import type { ChatEvent, ChatRequest } from "@/lib/agent/types";
import { MOCK_USER } from "@/lib/commerce/user";

export interface ChatTurnDeps {
  llm: LlmClient | null;
  executor: ToolExecutor;
  maxToolSteps: number;
  brandName: string;
  log?: (line: string) => void;
}

const MAX_TOOL_RESULT_CHARS = 12000;
const MAX_SUGGESTIONS = 4;

/**
 * One chat turn (§4.2): LLM tool loop with a deterministic fallback (§5.6).
 * Emits events in order and always finishes with `done`, unless the client disconnected.
 */
export async function runChatTurn(
  request: ChatRequest,
  emit: (event: ChatEvent) => void,
  deps: ChatTurnDeps,
  signal?: AbortSignal
): Promise<void> {
  const ctx = createExecutorContext(request.cart, signal);
  const lastMessage = request.messages[request.messages.length - 1]?.content ?? "";
  const intent = request.intent ? getChatIntent(request.intent) : intentFromText(lastMessage);
  let toolSteps = 0;
  let lastTool: ToolName | null = null;
  let emitted = false;

  async function runTool(name: string, rawArgs: unknown): Promise<ToolOutcome> {
    const known = isToolName(name);
    emit({
      event: "tool_status",
      data: known
        ? { tool: name, label: TOOL_LABELS[name] }
        : { tool: "unknown", label: "Working…" },
    });
    emitted = true;
    const started = Date.now();
    const outcome = await deps.executor.execute(name, rawArgs, ctx);
    toolSteps += 1;
    deps.log?.(
      `[chat] tool=${known ? name : "unknown"} ok=${outcome.ok} ms=${Date.now() - started}`
    );
    if (outcome.error) emit({ event: "error", data: outcome.error });
    for (const block of outcome.blocks) emit({ event: "block", data: block });
    if (outcome.cartUpdate) emit({ event: "cart_update", data: outcome.cartUpdate });
    if (known && (outcome.ok || outcome.blocks.length > 0)) lastTool = name;
    return outcome;
  }

  async function runDeterministic(turn: RoutedTurn): Promise<void> {
    emit({ event: "text", data: { delta: turn.text } });
    emitted = true;
    const outcome = await runTool(turn.name, turn.args);
    const products = (outcome.result as { products?: unknown }).products;
    if (outcome.ok && outcome.blocks.length === 0 && Array.isArray(products)) {
      emit({
        event: "text",
        data: {
          delta: " Nothing matches that right now. Try different dates or another type of event.",
        },
      });
    }
  }

  function fallbackTurn(): RoutedTurn {
    if (intent) return routeIntent(intent, lastMessage);
    return routeMessage(lastMessage, {
      productId: request.context.productId,
      cartItems: ctx.cart.items,
    });
  }

  async function runLlm(llm: LlmClient): Promise<void> {
    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({
          brandName: deps.brandName,
          user: MOCK_USER,
          context: request.context,
          cart: request.cart,
          locale: request.locale ?? "en",
        }),
      },
      ...request.messages.map((message) => ({ role: message.role, content: message.content })),
    ];
    let textSoFar = false;

    for (let round = 0; ; round += 1) {
      const toolChoice = toolSteps < deps.maxToolSteps ? "auto" : "none";
      let text = "";
      let calls: Array<{ id: string; name: string; arguments: string }> = [];

      for await (const event of llm.streamStep({
        messages,
        tools: TOOL_DEFINITIONS,
        toolChoice,
        ...(signal ? { signal } : {}),
      })) {
        if (event.type === "tool_calls") {
          calls = event.calls;
          continue;
        }
        // Drop leading whitespace of each round; separate rounds with a blank line.
        const delta = text === "" ? event.delta.trimStart() : event.delta;
        if (delta === "") continue;
        if (text === "" && textSoFar) emit({ event: "text", data: { delta: "\n\n" } });
        text += delta;
        textSoFar = true;
        emitted = true;
        emit({ event: "text", data: { delta } });
      }

      if (calls.length === 0 || toolChoice === "none") {
        // Some models end a tool-heavy turn with no prose; never leave the cards unexplained.
        if (!textSoFar && emitted) {
          emit({ event: "text", data: { delta: "Here's what I found for you." } });
        }
        return;
      }

      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const call of calls) {
        const result =
          toolSteps < deps.maxToolSteps
            ? (await runTool(call.name, call.arguments)).result
            : { error: "tool_step_limit_reached" };
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }
    }
  }

  function finish(fallback: boolean): void {
    if (lastTool) {
      emit({
        event: "suggestions",
        data: { chips: FOLLOW_UP_SUGGESTIONS[lastTool].slice(0, MAX_SUGGESTIONS) },
      });
    }
    emit({ event: "done", data: { steps: toolSteps, fallback } });
    deps.log?.(`[chat] turn steps=${toolSteps} fallback=${fallback}`);
  }

  const llm = deps.llm;
  if (!llm || (intent && !intent.preferLlm)) {
    await runDeterministic(fallbackTurn());
    finish(true);
    return;
  }

  try {
    await runLlm(llm);
  } catch (error) {
    if (signal?.aborted) return;
    const reason = error instanceof LlmError ? error.message : "LLM request failed";
    deps.log?.(`[chat] ${reason}`);
    emit({
      event: "error",
      data: { code: "llm_unavailable", message: "The assistant is in basic mode right now." },
    });
    if (!emitted) {
      await runDeterministic(fallbackTurn());
      finish(true);
      return;
    }
    finish(false);
    return;
  }

  if (!emitted) {
    await runDeterministic(fallbackTurn());
    finish(true);
    return;
  }
  finish(false);
}
