"use client";

import { ChevronLeft, ChevronRight, SquarePen, X } from "lucide-react";

import { Orb } from "@/components/chat/Orb";

interface CardControlsProps {
  onBack: () => void;
  onForward: (() => void) | null;
  onNewChat: () => void;
  onClose: () => void;
}

/** Row above the thread: back pill (with orb), optional forward, new chat and close. */
export function CardControls({ onBack, onForward, onNewChat, onClose }: CardControlsProps) {
  return (
    <div className="mb-4 flex h-[26px] items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to suggestions"
          className="flex h-[26px] w-[46px] items-center justify-center gap-1 rounded-pill bg-white text-text shadow-float"
        >
          <ChevronLeft className="size-3" strokeWidth={2.5} aria-hidden="true" />
          <Orb className="size-3.5" />
        </button>
        {onForward ? (
          <button
            type="button"
            onClick={onForward}
            aria-label="Next"
            className="grid size-[26px] place-items-center rounded-full bg-white text-text shadow-float"
          >
            <ChevronRight className="size-3" strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-8 items-center gap-1.5 rounded-pill bg-white px-3 text-caption font-medium text-text shadow-float"
        >
          <SquarePen className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          New chat
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="grid size-8 place-items-center rounded-full bg-white text-text shadow-float"
        >
          <X className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
