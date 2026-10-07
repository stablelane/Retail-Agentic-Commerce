"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  CHAT_LIMITS,
  type ChatIntentId,
  type ChatRequest,
  type NotificationBlock,
} from "@/lib/agent/types";
import { applyCartUpdate } from "@/lib/chat/cart-update";
import { chatContextFromPath } from "@/lib/chat/page-context";
import {
  CHAT_STORAGE_KEY,
  INITIAL_CHAT_STATE,
  buildHistory,
  chatReducer,
  isStreaming,
  parseChatState,
  serializeChatState,
  type ChatState,
  type ChatTurn,
  type Feedback,
} from "@/lib/chat/session";
import { ChatHttpError, isAbortError, streamChat } from "@/lib/chat/sse-client";
import { cartStore } from "@/lib/commerce/cart-store";

const OFFLINE_ERROR = "We couldn't reach the assistant. Check your connection and try again.";

export interface ChatSession {
  state: ChatState;
  activeTurn: ChatTurn | undefined;
  streaming: boolean;
  draft: string;
  setDraft: (text: string) => void;
  send: (text: string, intent?: ChatIntentId) => void;
  retry: (turnId: string) => void;
  stop: () => void;
  back: () => void;
  forward: () => void;
  /** Cancel any reply and start an empty conversation. */
  reset: () => void;
  setFeedback: (turnId: string, value: Feedback) => void;
  notify: (block: NotificationBlock) => void;
}

let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `turn_${Date.now().toString(36)}_${turnCounter}`;
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function hydratingReducer(state: ChatState, action: Parameters<typeof chatReducer>[1]): ChatState {
  // A restored conversation never overwrites turns started before it loaded.
  if (action.type === "hydrate" && state.turns.length > 0) return state;
  return chatReducer(state, action);
}

/** Conversation state plus the streaming `/api/chat` client, cart snapshot and page context. */
export function useChatSession({ fetchImpl }: { fetchImpl?: typeof fetch } = {}): ChatSession {
  const pathname = usePathname();
  const [state, dispatch] = useReducer(hydratingReducer, INITIAL_CHAT_STATE);
  const [draft, setDraft] = useState("");
  const stateRef = useRef(state);
  const pathnameRef = useRef(pathname);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const restored = parseChatState(sessionStorageOrNull()?.getItem(CHAT_STORAGE_KEY) ?? null);
    if (restored && restored.turns.length > 0) dispatch({ type: "hydrate", state: restored });
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (state === INITIAL_CHAT_STATE || isStreaming(state)) return;
    try {
      sessionStorageOrNull()?.setItem(CHAT_STORAGE_KEY, serializeChatState(state));
    } catch {
      // Storage full or blocked; the conversation still lives in memory.
    }
  }, [state]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const send = useCallback(
    (text: string, intent?: ChatIntentId) => {
      const prompt = text.trim().slice(0, CHAT_LIMITS.maxMessageLength);
      if (!prompt) return;
      controllerRef.current?.abort();

      const id = nextTurnId();
      const history = buildHistory(stateRef.current.turns);
      const cart = cartStore.getSnapshot();
      const request: ChatRequest = {
        messages: [...history, { role: "user", content: prompt }],
        cart: {
          sessionId: cart.sessionId,
          items: cart.items
            .slice(0, CHAT_LIMITS.maxCartItems)
            .map((item) => ({ id: item.id, quantity: item.quantity })),
        },
        context: chatContextFromPath(pathnameRef.current),
        ...(intent ? { intent } : {}),
      };

      const controller = new AbortController();
      controllerRef.current = controller;
      dispatch({ type: "start", id, prompt, intent });
      setDraft("");

      streamChat(request, {
        signal: controller.signal,
        fetchImpl,
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          // Applied here, once per event, never during render.
          if (event.event === "cart_update" && Array.isArray(event.data.items)) {
            applyCartUpdate(event.data.items);
          }
          dispatch({ type: "event", id, event });
        },
      })
        .then(() => dispatch({ type: "finish", id }))
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) {
            dispatch({ type: "cancel", id });
          } else {
            dispatch({
              type: "fail",
              id,
              message: error instanceof ChatHttpError ? error.message : OFFLINE_ERROR,
            });
          }
        })
        .finally(() => {
          if (controllerRef.current === controller) controllerRef.current = null;
        });
    },
    [fetchImpl]
  );

  const retry = useCallback(
    (turnId: string) => {
      const turn = stateRef.current.turns.find((candidate) => candidate.id === turnId);
      if (turn) send(turn.prompt, turn.intent);
    },
    [send]
  );

  const back = useCallback(() => dispatch({ type: "back" }), []);
  const forward = useCallback(() => dispatch({ type: "forward" }), []);
  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "reset" });
    setDraft("");
    try {
      sessionStorageOrNull()?.removeItem(CHAT_STORAGE_KEY);
    } catch {
      // Storage blocked; nothing persisted to clear.
    }
  }, []);
  const setFeedback = useCallback(
    (turnId: string, value: Feedback) => dispatch({ type: "feedback", id: turnId, value }),
    []
  );
  const notify = useCallback(
    (block: NotificationBlock) => dispatch({ type: "notify", id: nextTurnId(), block }),
    []
  );

  return useMemo(
    () => ({
      state,
      activeTurn: state.turns[state.activeIndex],
      streaming: isStreaming(state),
      draft,
      setDraft,
      send,
      retry,
      stop,
      back,
      forward,
      reset,
      setFeedback,
      notify,
    }),
    [state, draft, send, retry, stop, back, forward, reset, setFeedback, notify]
  );
}
