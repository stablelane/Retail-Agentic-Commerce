"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { BlockActions } from "@/components/chat/blocks/BlockActions";
import { CardControls } from "@/components/chat/CardControls";
import { useChat, useChatSessionContext } from "@/components/chat/ChatProvider";
import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { ResponseCard } from "@/components/chat/ResponseCard";
import { useBag } from "@/components/store/BagProvider";
import type { ChatIntentId } from "@/lib/agent/types";
import { composerPlaceholder } from "@/lib/chat/session";
import { cn } from "@/lib/cn";
import { MOCK_USER } from "@/lib/commerce/user";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Full-viewport chat takeover (§2.11): empty state or the conversation thread, plus the composer. */
export function ChatOverlay() {
  const { isOpen, closeChat } = useChat();
  const { openBag } = useBag();
  const {
    state,
    activeTurn,
    streaming,
    draft,
    setDraft,
    send,
    stop,
    retry,
    back,
    forward,
    reset,
    setFeedback,
  } = useChatSessionContext();
  const dialogRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const showThread = activeTurn !== undefined;
  const turnCount = state.turns.length;

  const scrollToBottom = useCallback(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, []);

  // A new question (or reopening the thread) jumps to the latest message.
  useEffect(() => {
    if (!isOpen || !showThread) return;
    stickToBottomRef.current = true;
    scrollToBottom();
  }, [isOpen, showThread, turnCount, scrollToBottom]);

  // Follow streamed text, blocks and late-loading images unless the reader scrolled up.
  useEffect(() => {
    const content = threadContentRef.current;
    if (!isOpen || !showThread || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [isOpen, showThread, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    composerRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeChat();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restore =
        previouslyFocused?.isConnected && previouslyFocused !== document.body
          ? previouslyFocused
          : document.querySelector<HTMLElement>("[data-chat-launcher]");
      restore?.focus();
    };
  }, [isOpen, closeChat]);

  // Chips, follow-ups and back unmount the focused control; keep focus in the composer.
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);

  const sendAndFocus = useCallback(
    (text: string, intent?: ChatIntentId) => {
      send(text, intent);
      focusComposer();
    },
    [send, focusComposer]
  );

  const actions = useMemo<BlockActions>(
    () => ({
      send: sendAndFocus,
      navigate: closeChat,
      viewBag: () => {
        closeChat();
        openBag();
      },
      email: MOCK_USER.email,
    }),
    [sendAndFocus, closeChat, openBag]
  );

  const lastIndex = state.turns.length - 1;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Shopping assistant"
      inert={!isOpen}
      className={cn(
        "fixed inset-0 z-[60] bg-scrim backdrop-blur-overlay transition-[opacity,visibility] duration-300",
        isOpen ? "visible opacity-100" : "pointer-events-none invisible opacity-0"
      )}
    >
      {showThread ? null : (
        <button
          type="button"
          onClick={closeChat}
          aria-label="Close chat"
          className="absolute top-8 right-8 z-10 grid size-8 place-items-center rounded-full bg-white text-text shadow-float"
        >
          <X className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
      <div className="flex h-full flex-col items-center overflow-y-auto px-4">
        {activeTurn ? (
          <div className="flex w-full max-w-(--chat-card-width) flex-col pt-[92px]">
            <CardControls
              onBack={() => {
                back();
                focusComposer();
              }}
              onForward={null}
              onNewChat={() => {
                reset();
                focusComposer();
              }}
              onClose={closeChat}
            />
            <div
              ref={threadRef}
              onScroll={(event) => {
                const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
                stickToBottomRef.current = scrollHeight - scrollTop - clientHeight < 48;
              }}
              className="h-[clamp(420px,calc(100vh_-_270px),560px)] w-full overflow-y-auto overscroll-contain rounded-panel bg-white p-5 shadow-deep [scrollbar-width:thin]"
            >
              <div ref={threadContentRef} className="flex flex-col gap-8">
                {state.turns.map((turn, index) => (
                  <ResponseCard
                    key={turn.id}
                    turn={turn}
                    actions={actions}
                    isLatest={index === lastIndex}
                    onRetry={(turnId) => {
                      retry(turnId);
                      focusComposer();
                    }}
                    onFeedback={setFeedback}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <EmptyState onPick={(intent) => sendAndFocus(intent.label, intent.id)} />
            {state.turns.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  forward();
                  focusComposer();
                }}
                className="mt-4 rounded-pill bg-white px-4 py-1.5 text-caption font-medium text-text shadow-float"
              >
                Back to conversation
              </button>
            ) : null}
          </>
        )}
        <div
          className={cn(
            "mb-6 w-full max-w-(--chat-composer-width) shrink-0",
            showThread ? "mt-4" : "mt-6"
          )}
        >
          <Composer
            value={draft}
            onValueChange={setDraft}
            onSend={(text) => send(text)}
            onStop={stop}
            streaming={streaming}
            placeholder={composerPlaceholder(activeTurn)}
            inputRef={composerRef}
          />
        </div>
      </div>
    </div>
  );
}
