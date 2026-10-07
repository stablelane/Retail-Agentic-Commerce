"use client";

import { Orb } from "@/components/chat/Orb";
import { SuggestionChips } from "@/components/chat/SuggestionChips";
import type { ChatIntent } from "@/lib/agent/intents";

export function EmptyState({ onPick }: { onPick: (intent: ChatIntent) => void }) {
  return (
    <div className="flex w-full max-w-(--chat-composer-width) flex-1 flex-col items-center justify-end pt-20">
      <Orb className="size-9" />
      <h2 className="mt-5 text-center text-title font-semibold text-white">
        Hi, how can I help you?
      </h2>
      <div className="mt-4">
        <SuggestionChips onPick={onPick} />
      </div>
    </div>
  );
}
