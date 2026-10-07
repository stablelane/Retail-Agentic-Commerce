"use client";

import { ArrowUp, Mic, Search, Square } from "lucide-react";
import { useEffect, useId, type RefObject } from "react";

import { CHAT_LIMITS } from "@/lib/agent/types";
import { cn } from "@/lib/cn";

const MAX_HEIGHT_PX = 120;

interface ComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: (value: string) => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** White pill composer: Enter sends, Shift+Enter adds a line, stop while streaming. */
export function Composer({
  value,
  onValueChange,
  onSend,
  onStop,
  streaming,
  placeholder,
  inputRef,
}: ComposerProps) {
  const id = useId();
  const hasText = value.trim().length > 0;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight || 20, MAX_HEIGHT_PX)}px`;
  }, [value, inputRef]);

  function submit() {
    if (streaming || !hasText) return;
    onSend(value);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex min-h-10 w-full items-center gap-2 rounded-[20px] bg-white px-3 shadow-float focus-within:ring-2 focus-within:ring-primary/40"
    >
      <Search className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
      <label htmlFor={id} className="sr-only">
        Message the shopping assistant
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        readOnly={streaming}
        aria-busy={streaming}
        placeholder={placeholder}
        maxLength={CHAT_LIMITS.maxMessageLength}
        enterKeyHint="send"
        className={cn(
          "max-h-[120px] min-w-0 flex-1 resize-none bg-transparent py-2.5 text-small leading-5 text-text placeholder:text-text-secondary focus:outline-none focus-visible:outline-none",
          streaming && "animate-pulse"
        )}
      />
      {streaming ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop response"
          className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-white"
        >
          <Square className="size-2.5 fill-current" aria-hidden="true" />
        </button>
      ) : hasText ? (
        <button
          type="submit"
          aria-label="Send message"
          className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-white"
        >
          <ArrowUp className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        <span title="Voice coming soon" className="shrink-0 text-primary">
          <Mic className="size-4" aria-hidden="true" />
        </span>
      )}
    </form>
  );
}
