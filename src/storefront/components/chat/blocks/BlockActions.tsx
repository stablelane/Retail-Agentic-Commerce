"use client";

import { createContext, useContext } from "react";

import type { ChatIntentId } from "@/lib/agent/types";
import { MOCK_USER } from "@/lib/commerce/user";

/** Actions blocks can trigger without knowing about the overlay or the bag drawer. */
export interface BlockActions {
  send: (text: string, intent?: ChatIntentId) => void;
  /** Called before following a link out of the chat (closes the overlay, keeps state). */
  navigate: () => void;
  viewBag: () => void;
  /** Email used for order links (the one the user typed, else the signed-in user's). */
  email: string;
}

const noop = () => undefined;

export const BlockActionsContext = createContext<BlockActions>({
  send: noop,
  navigate: noop,
  viewBag: noop,
  email: MOCK_USER.email,
});

export function useBlockActions(): BlockActions {
  return useContext(BlockActionsContext);
}
