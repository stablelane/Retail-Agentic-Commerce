"use client";

import { useEffect, useState } from "react";

import { useChat } from "@/components/chat/ChatProvider";
import { Orb } from "@/components/chat/Orb";
import { cn } from "@/lib/cn";
import { LAUNCHER_FADE_MS, LAUNCHER_LABELS, LAUNCHER_ROTATE_MS } from "@/lib/content/launcher";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function ChatLauncher() {
  const { isOpen, openChat, unreadCount } = useChat();
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || isOpen || prefersReducedMotion()) return;
    let fade: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setVisible(false);
      fade = setTimeout(() => {
        setIndex((current) => (current + 1) % LAUNCHER_LABELS.length);
        setVisible(true);
      }, LAUNCHER_FADE_MS);
    }, LAUNCHER_ROTATE_MS);
    return () => {
      clearInterval(interval);
      if (fade) clearTimeout(fade);
    };
  }, [paused, isOpen]);

  const unreadLabel =
    unreadCount > 0 ? `${unreadCount} ${unreadCount === 1 ? "message" : "messages"}` : null;

  // Hidden rather than unmounted so the overlay can hand focus back to it on close.
  return (
    <div hidden={isOpen} className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      {unreadLabel ? (
        <span
          aria-hidden="true"
          className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded-pill bg-badge-dark px-2.5 py-[3px] text-[11px] leading-none font-semibold whitespace-nowrap text-white"
        >
          {unreadLabel}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-badge-dark" />
        </span>
      ) : null}
      <button
        type="button"
        onClick={openChat}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        aria-haspopup="dialog"
        data-chat-launcher=""
        aria-label={unreadLabel ? `Chat with our AI (${unreadLabel})` : "Chat with our AI"}
        className="flex h-9 items-center gap-2 rounded-pill bg-white py-2 pr-4 pl-3 shadow-float"
      >
        <Orb className="size-4" />
        <span
          aria-hidden="true"
          className={cn(
            "text-caption font-semibold whitespace-nowrap text-text transition-opacity duration-200",
            visible ? "opacity-100" : "opacity-0"
          )}
        >
          {LAUNCHER_LABELS[index]}
        </span>
      </button>
    </div>
  );
}
