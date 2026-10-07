"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getSessionSyncer } from "@/lib/commerce/session-sync";

interface BagContextValue {
  isOpen: boolean;
  openBag: () => void;
  closeBag: () => void;
}

const BagContext = createContext<BagContextValue | null>(null);

/** Bag drawer state; also keeps the cart mirrored to an ACP checkout session. */
export function BagProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const openBag = useCallback(() => setIsOpen(true), []);
  const closeBag = useCallback(() => setIsOpen(false), []);

  useEffect(() => getSessionSyncer().start(), []);

  const value = useMemo(() => ({ isOpen, openBag, closeBag }), [isOpen, openBag, closeBag]);
  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag(): BagContextValue {
  const context = useContext(BagContext);
  if (!context) throw new Error("useBag must be used within BagProvider");
  return context;
}
