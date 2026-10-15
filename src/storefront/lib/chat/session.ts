/** Chat conversation state: turns, streaming reducer and request history (feature 18, §2.11). */

import {
  CHAT_LIMITS,
  type ChatEvent,
  type ChatIntentId,
  type ChatMessage,
  type NotificationBlock,
  type UIBlock,
  type UIBlockType,
} from "@/lib/agent/types";

export type TurnItem =
  | { kind: "text"; text: string }
  | { kind: "block"; block: UIBlock }
  | { kind: "cart_update"; itemCount: number }
  | { kind: "error"; message: string };

export type TurnStatus = "streaming" | "done" | "error" | "cancelled";

export type Feedback = "up" | "down" | null;

export interface ChatTurn {
  id: string;
  source: "user" | "notification";
  /** The user's prompt or chip label (card title). */
  prompt: string;
  intent?: ChatIntentId;
  items: TurnItem[];
  toolStatus: string | null;
  suggestions: string[];
  status: TurnStatus;
  /** Turn-level failure (request or stream broke), shown with a Retry chip. */
  error: string | null;
  feedback: Feedback;
}

export interface ChatState {
  turns: ChatTurn[];
  /** -1 shows the empty state; otherwise the conversation thread (index of the latest turn). */
  activeIndex: number;
}

export type ChatAction =
  | { type: "start"; id: string; prompt: string; intent?: ChatIntentId | undefined }
  | { type: "event"; id: string; event: ChatEvent }
  | { type: "finish"; id: string }
  | { type: "fail"; id: string; message: string }
  | { type: "cancel"; id: string }
  | { type: "notify"; id: string; block: NotificationBlock }
  | { type: "back" }
  | { type: "forward" }
  | { type: "feedback"; id: string; value: Feedback }
  | { type: "reset" }
  | { type: "hydrate"; state: ChatState };

export const INITIAL_CHAT_STATE: ChatState = { turns: [], activeIndex: -1 };

const BLOCK_TYPES: readonly UIBlockType[] = [
  "product_carousel",
  "cart_summary",
  "checkout_panel",
  "order_form",
  "order_status",
  "account_summary",
  "notification",
  "upi_mandate",
  "upi_payment",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Known block type with the fields its renderer relies on; anything else is ignored. */
export function isRenderableBlock(value: unknown): value is UIBlock {
  if (!isRecord(value) || !(BLOCK_TYPES as readonly unknown[]).includes(value.type)) return false;
  switch (value.type as UIBlockType) {
    case "product_carousel":
      return Array.isArray(value.products) && value.products.every(isRecord);
    case "cart_summary":
      return Array.isArray(value.items) && value.items.every(isRecord);
    case "checkout_panel":
      return typeof value.itemCount === "number";
    case "order_form":
      return isRecord(value.prefill);
    case "order_status":
      return typeof value.orderId === "string" && typeof value.status === "string";
    case "account_summary":
      return typeof value.name === "string";
    case "notification":
      return typeof value.message === "string" && typeof value.orderId === "string";
    case "upi_mandate":
      return typeof value.mandateId === "string";
    case "upi_payment":
      return typeof value.status === "string";
  }
}

function updateTurn(state: ChatState, id: string, update: (turn: ChatTurn) => ChatTurn): ChatState {
  const index = state.turns.findIndex((turn) => turn.id === id);
  const turn = state.turns[index];
  if (!turn) return state;
  const turns = state.turns.slice();
  turns[index] = update(turn);
  return { ...state, turns };
}

function appendText(items: TurnItem[], delta: string): TurnItem[] {
  const last = items[items.length - 1];
  if (last?.kind === "text")
    return [...items.slice(0, -1), { kind: "text", text: last.text + delta }];
  return [...items, { kind: "text", text: delta }];
}

function applyEvent(turn: ChatTurn, event: ChatEvent): ChatTurn {
  if (turn.status !== "streaming") return turn;
  switch (event.event) {
    case "text":
      return typeof event.data.delta === "string" && event.data.delta
        ? { ...turn, items: appendText(turn.items, event.data.delta) }
        : turn;
    case "tool_status":
      return { ...turn, toolStatus: String(event.data.label || "Working on it…") };
    case "block":
      return isRenderableBlock(event.data)
        ? {
            ...turn,
            toolStatus: null,
            items: [...turn.items, { kind: "block", block: event.data }],
          }
        : { ...turn, toolStatus: null };
    case "cart_update": {
      const items = Array.isArray(event.data.items) ? event.data.items : [];
      const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      return { ...turn, items: [...turn.items, { kind: "cart_update", itemCount }] };
    }
    case "suggestions":
      return {
        ...turn,
        suggestions: Array.isArray(event.data.chips)
          ? event.data.chips.filter((chip) => typeof chip === "string" && chip.trim()).slice(0, 4)
          : [],
      };
    case "error":
      return {
        ...turn,
        toolStatus: null,
        items: [...turn.items, { kind: "error", message: String(event.data.message || "") }],
      };
    case "done":
      return { ...turn, status: "done", toolStatus: null };
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "start": {
      const turn: ChatTurn = {
        id: action.id,
        source: "user",
        prompt: action.prompt,
        ...(action.intent ? { intent: action.intent } : {}),
        items: [],
        toolStatus: null,
        suggestions: [],
        status: "streaming",
        error: null,
        feedback: null,
      };
      const turns = [...state.turns, turn];
      return { turns, activeIndex: turns.length - 1 };
    }
    case "event":
      return updateTurn(state, action.id, (turn) => applyEvent(turn, action.event));
    case "finish":
      return updateTurn(state, action.id, (turn) =>
        turn.status === "streaming" ? { ...turn, status: "done", toolStatus: null } : turn
      );
    case "fail":
      return updateTurn(state, action.id, (turn) =>
        turn.status === "streaming"
          ? { ...turn, status: "error", toolStatus: null, error: action.message }
          : turn
      );
    case "cancel":
      return updateTurn(state, action.id, (turn) =>
        turn.status === "streaming" ? { ...turn, status: "cancelled", toolStatus: null } : turn
      );
    case "notify": {
      const turn: ChatTurn = {
        id: action.id,
        source: "notification",
        prompt: action.block.subject || "Order update",
        items: [{ kind: "block", block: action.block }],
        toolStatus: null,
        suggestions: [],
        status: "done",
        error: null,
        feedback: null,
      };
      const turns = [...state.turns, turn];
      return { turns, activeIndex: turns.length - 1 };
    }
    case "back":
      return state.activeIndex < 0 ? state : { ...state, activeIndex: -1 };
    case "forward":
      return state.turns.length === 0 || state.activeIndex === state.turns.length - 1
        ? state
        : { ...state, activeIndex: state.turns.length - 1 };
    case "feedback":
      return updateTurn(state, action.id, (turn) => ({
        ...turn,
        feedback: turn.feedback === action.value ? null : action.value,
      }));
    case "reset":
      return INITIAL_CHAT_STATE;
    case "hydrate":
      return action.state;
  }
}

export function isStreaming(state: ChatState): boolean {
  return state.turns.some((turn) => turn.status === "streaming");
}

function clip(text: string): string {
  return text.trim().slice(0, CHAT_LIMITS.maxMessageLength);
}

function describeBlock(block: UIBlock): string | null {
  switch (block.type) {
    case "product_carousel":
      return `Showed products: ${block.products.map((product) => `${product.name} (${product.id})`).join(", ")}`;
    case "cart_summary":
      return `Showed the bag with ${block.items.length} line items`;
    case "checkout_panel":
      return "Offered checkout";
    case "order_form":
      return "Asked for an order number and email";
    case "order_status":
      return `Order ${block.orderId} status: ${block.status}`;
    case "upi_mandate":
      return `UPI mandate ${block.mandateId}: ${block.status}`;
    case "upi_payment":
      return `UPI payment ${block.status}${block.orderId ? `, order ${block.orderId}` : ""}`;
    default:
      return null;
  }
}

/** What the assistant said and showed in a turn, as plain text for the model's history. */
function assistantContent(turn: ChatTurn): string {
  const parts: string[] = [];
  for (const item of turn.items) {
    if (item.kind === "text" && item.text.trim()) parts.push(item.text.trim());
    if (item.kind === "block") {
      const summary = describeBlock(item.block);
      if (summary) parts.push(`[${summary}]`);
    }
  }
  return clip(parts.join("\n"));
}

/** Prior user turns as alternating messages, leaving room for the new prompt. */
export function buildHistory(turns: readonly ChatTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    if (turn.source !== "user" || turn.status === "streaming") continue;
    const prompt = clip(turn.prompt);
    if (!prompt) continue;
    messages.push({ role: "user", content: prompt });
    const reply = assistantContent(turn);
    if (reply) messages.push({ role: "assistant", content: reply });
  }
  return messages.slice(-(CHAT_LIMITS.maxMessages - 1));
}

export function lastBlockType(turn: ChatTurn | undefined): UIBlockType | null {
  if (!turn) return null;
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.kind === "block") return item.block.type;
  }
  return null;
}

/** Contextual composer placeholder (§2.11). */
export function composerPlaceholder(turn: ChatTurn | undefined): string {
  if (!turn) return "What can I help you with today?";
  switch (lastBlockType(turn)) {
    case "order_form":
    case "order_status":
      return "Need more details?";
    case "product_carousel":
      return "What else would you like to know?";
    case "cart_summary":
    case "checkout_panel":
      return "Anything else for your bag?";
    default:
      return "Ask a follow-up…";
  }
}

// ---------------------------------------------------------------------------
// sessionStorage persistence across reloads within the tab.
// ---------------------------------------------------------------------------

export const CHAT_STORAGE_KEY = "matter.chat.v1";
const MAX_STORED_TURNS = 30;
const STORED_STATUSES: readonly TurnStatus[] = ["done", "error", "cancelled"];

function isStoredTurn(value: unknown): value is ChatTurn {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.source === "user" || value.source === "notification") &&
    typeof value.prompt === "string" &&
    Array.isArray(value.items) &&
    Array.isArray(value.suggestions)
  );
}

function sanitizeItems(items: unknown[]): TurnItem[] {
  return items.filter((item): item is TurnItem => {
    if (!isRecord(item)) return false;
    if (item.kind === "text") return typeof item.text === "string";
    if (item.kind === "error") return typeof item.message === "string";
    if (item.kind === "block") return isRenderableBlock(item.block);
    return item.kind === "cart_update" && typeof item.itemCount === "number";
  });
}

export function serializeChatState(state: ChatState): string {
  const turns = state.turns.slice(-MAX_STORED_TURNS);
  const offset = state.turns.length - turns.length;
  return JSON.stringify({ turns, activeIndex: Math.max(-1, state.activeIndex - offset) });
}

export function parseChatState(raw: string | null): ChatState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.turns)) return null;
    const turns = parsed.turns.filter(isStoredTurn).map((turn): ChatTurn => ({
      ...turn,
      items: sanitizeItems(turn.items),
      suggestions: turn.suggestions.filter((chip) => typeof chip === "string"),
      toolStatus: null,
      status: STORED_STATUSES.includes(turn.status) ? turn.status : "cancelled",
      error: typeof turn.error === "string" ? turn.error : null,
      feedback: turn.feedback === "up" || turn.feedback === "down" ? turn.feedback : null,
    }));
    const active = Number(parsed.activeIndex);
    const activeIndex = Number.isInteger(active)
      ? Math.min(Math.max(-1, active), turns.length - 1)
      : turns.length - 1;
    return { turns, activeIndex };
  } catch {
    return null;
  }
}
