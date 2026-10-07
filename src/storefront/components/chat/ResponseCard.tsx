"use client";

import { useMemo } from "react";

import { BlockActionsContext, type BlockActions } from "@/components/chat/blocks/BlockActions";
import { BlockRenderer } from "@/components/chat/blocks/BlockRenderer";
import { CartUpdateNotice } from "@/components/chat/blocks/CartUpdateNotice";
import { Feedback } from "@/components/chat/Feedback";
import { FollowUpChips } from "@/components/chat/FollowUpChips";
import { RichText } from "@/components/chat/RichText";
import { ToolStatus } from "@/components/chat/ToolStatus";
import type { ChatTurn, Feedback as FeedbackValue } from "@/lib/chat/session";

const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/;

interface ResponseCardProps {
  turn: ChatTurn;
  actions: BlockActions;
  onRetry: (turnId: string) => void;
  onFeedback: (turnId: string, value: FeedbackValue) => void;
  /** Follow-up chips are only offered on the latest turn. */
  isLatest?: boolean;
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="h-3.5 w-3/4 animate-pulse rounded-badge bg-surface-strong" />
      <div className="h-3.5 w-2/3 animate-pulse rounded-badge bg-surface-strong" />
      <div className="h-3.5 w-1/2 animate-pulse rounded-badge bg-surface-strong" />
    </div>
  );
}

/** One turn in the thread: the prompt bubble, then streamed text and blocks, status and feedback. */
export function ResponseCard({
  turn,
  actions,
  onRetry,
  onFeedback,
  isLatest = true,
}: ResponseCardProps) {
  const streaming = turn.status === "streaming";
  const titleId = `${turn.id}-title`;
  // Order links reuse the email the user typed in this turn, if any.
  const email = EMAIL_IN_TEXT.exec(turn.prompt)?.[0] ?? actions.email;
  const turnActions = useMemo(() => ({ ...actions, email }), [actions, email]);
  const showSkeleton = streaming && turn.items.length === 0 && !turn.toolStatus;

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={streaming}
      data-turn-id={turn.id}
      className="flex w-full flex-col"
    >
      <h2
        id={titleId}
        className={
          turn.source === "user"
            ? "max-w-[85%] self-end rounded-panel bg-surface px-4 py-2.5 text-body font-medium break-words text-text"
            : "text-title font-semibold break-words text-text"
        }
      >
        {turn.prompt}
      </h2>
      <p aria-live="polite" className="sr-only">
        {streaming ? "Assistant is responding" : turn.status === "done" ? "Response ready" : ""}
      </p>

      <BlockActionsContext.Provider value={turnActions}>
        <div className="mt-4 flex flex-col gap-4">
          {turn.items.map((item, index) => {
            switch (item.kind) {
              case "text":
                return <RichText key={index} text={item.text} />;
              case "block":
                return <BlockRenderer key={index} block={item.block} />;
              case "cart_update":
                return <CartUpdateNotice key={index} itemCount={item.itemCount} />;
              case "error":
                return (
                  <p key={index} className="rounded-card bg-surface p-4 text-caption text-text">
                    {item.message || "Something went wrong."}
                  </p>
                );
            }
          })}
          {showSkeleton ? <Skeleton /> : null}
          {turn.toolStatus ? <ToolStatus label={turn.toolStatus} /> : null}
          {turn.status === "error" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4 text-caption text-text"
            >
              <span>{turn.error}</span>
              {turn.source === "user" ? (
                <button type="button" onClick={() => onRetry(turn.id)} className="btn-outline">
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          {turn.status === "cancelled" ? (
            <p className="text-caption text-text-secondary">Stopped.</p>
          ) : null}
        </div>
      </BlockActionsContext.Provider>

      {turn.status === "done" && turn.source === "user" ? (
        <div className="mt-4 flex flex-col gap-4">
          <Feedback value={turn.feedback} onChange={(value) => onFeedback(turn.id, value)} />
          {isLatest ? (
            <FollowUpChips chips={turn.suggestions} onPick={(chip) => actions.send(chip)} />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
