"use client";

import { List, Search, Sparkles, Truck, type LucideIcon } from "lucide-react";

import { CHAT_INTENTS, type ChatIntent, type ChatIntentIcon } from "@/lib/agent/intents";

const ICONS: Record<ChatIntentIcon, LucideIcon> = {
  sparkles: Sparkles,
  truck: Truck,
  search: Search,
  list: List,
};

/** Glass suggestion chips for the empty state (§2.11). */
export function SuggestionChips({ onPick }: { onPick: (intent: ChatIntent) => void }) {
  return (
    <ul aria-label="Suggestions" className="flex flex-wrap justify-center gap-1.5">
      {CHAT_INTENTS.map((intent) => {
        const Icon = ICONS[intent.icon];
        return (
          <li key={intent.id}>
            <button
              type="button"
              onClick={() => onPick(intent)}
              className="flex items-center gap-1.5 rounded-pill bg-glass py-1.5 pr-3 pl-2.5 text-caption font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {intent.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
