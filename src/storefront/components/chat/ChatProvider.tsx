"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CHAT_LIMITS, type ChatIntentId, type NotificationBlock } from "@/lib/agent/types";
import { useChatSession, type ChatSession } from "@/lib/chat/useChatSession";
import { useNotifications } from "@/lib/notifications/useNotifications";

interface ChatContextValue {
  isOpen: boolean;
  /** Notifications that arrived while the overlay was closed. */
  unreadCount: number;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  /** Open the overlay and send a prompt right away. */
  askChat: (prompt: string, intent?: ChatIntentId) => void;
  /** Open the overlay with the composer prefilled. */
  prefillChat: (text: string) => void;
  /** Push an order notification card; badges the launcher when closed. */
  notify: (block: NotificationBlock) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);
const ChatSessionContext = createContext<ChatSession | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const session = useChatSession();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isOpenRef = useRef(isOpen);
  const { send, stop, setDraft, notify: pushNotification } = session;

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const openChat = useCallback(() => {
    isOpenRef.current = true;
    setIsOpen(true);
    setUnreadCount(0);
  }, []);

  // Closing cancels an in-flight turn; the partial answer stays in history.
  const closeChat = useCallback(() => {
    stop();
    isOpenRef.current = false;
    setIsOpen(false);
  }, [stop]);

  const toggleChat = useCallback(() => {
    if (isOpenRef.current) closeChat();
    else openChat();
  }, [closeChat, openChat]);

  const askChat = useCallback(
    (prompt: string, intent?: ChatIntentId) => {
      openChat();
      send(prompt, intent);
    },
    [openChat, send]
  );

  const prefillChat = useCallback(
    (text: string) => {
      setDraft(text.slice(0, CHAT_LIMITS.maxMessageLength));
      openChat();
    },
    [openChat, setDraft]
  );

  const notify = useCallback(
    (block: NotificationBlock) => {
      pushNotification(block);
      if (!isOpenRef.current) setUnreadCount((count) => count + 1);
    },
    [pushNotification]
  );

  useNotifications(notify);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleChat();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggleChat]);

  // Deep link `?chat=<prompt>` prefills the composer; it never sends on its own.
  useEffect(() => {
    const url = new URL(window.location.href);
    const prompt = url.searchParams.get("chat")?.trim();
    if (!prompt) return;
    // Deferred past hydration; cleared if the effect is torn down first (Strict Mode).
    const timer = setTimeout(() => {
      url.searchParams.delete("chat");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`
      );
      prefillChat(prompt);
    }, 0);
    return () => clearTimeout(timer);
  }, [prefillChat]);

  const value = useMemo(
    () => ({
      isOpen,
      unreadCount,
      openChat,
      closeChat,
      toggleChat,
      askChat,
      prefillChat,
      notify,
    }),
    [isOpen, unreadCount, openChat, closeChat, toggleChat, askChat, prefillChat, notify]
  );

  return (
    <ChatContext.Provider value={value}>
      <ChatSessionContext.Provider value={session}>{children}</ChatSessionContext.Provider>
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used within ChatProvider");
  return context;
}

export function useChatSessionContext(): ChatSession {
  const context = useContext(ChatSessionContext);
  if (!context) throw new Error("useChatSessionContext must be used within ChatProvider");
  return context;
}
