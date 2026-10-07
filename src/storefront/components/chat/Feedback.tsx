"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Feedback as FeedbackValue } from "@/lib/chat/session";

/** Thumbs up/down; kept in local conversation state only (no analytics backend yet). */
export function Feedback({
  value,
  onChange,
}: {
  value: FeedbackValue;
  onChange: (value: FeedbackValue) => void;
}) {
  const button = (kind: "up" | "down") =>
    cn(
      "grid size-6 place-items-center rounded-full transition-colors hover:text-text",
      value === kind ? "text-primary" : "text-text-secondary"
    );
  return (
    <div role="group" aria-label="Rate this answer" className="flex items-center gap-3">
      <button
        type="button"
        aria-label="Helpful"
        aria-pressed={value === "up"}
        onClick={() => onChange("up")}
        className={button("up")}
      >
        <ThumbsUp className={cn("size-4", value === "up" && "fill-current")} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        aria-pressed={value === "down"}
        onClick={() => onChange("down")}
        className={button("down")}
      >
        <ThumbsDown
          className={cn("size-4", value === "down" && "fill-current")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
