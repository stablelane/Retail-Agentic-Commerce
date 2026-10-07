"use client";

import { useChat } from "@/components/chat/ChatProvider";
import { Orb } from "@/components/chat/Orb";

export function OpenChatButton({
  label = "Chat with our AI",
  prompt,
}: {
  label?: string;
  /** Prefills the composer, e.g. `Where is order order_123?`. */
  prompt?: string;
}) {
  const { openChat, prefillChat } = useChat();
  return (
    <button
      type="button"
      onClick={() => (prompt ? prefillChat(prompt) : openChat())}
      aria-haspopup="dialog"
      className="btn-pill"
    >
      <Orb className="size-4" />
      {label}
    </button>
  );
}
