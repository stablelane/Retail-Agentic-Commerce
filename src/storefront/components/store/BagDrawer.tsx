"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { BagContents } from "@/components/store/BagContents";
import { useBag } from "@/components/store/BagProvider";
import { cartItemCount, useCart } from "@/lib/commerce/cart-store";
import { cn } from "@/lib/cn";

export function BagDrawer() {
  const { isOpen, closeBag } = useBag();
  const { items } = useCart();
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = cartItemCount(items);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeBag();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [isOpen, closeBag]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[45] transition-[visibility] duration-300",
        isOpen ? "visible" : "invisible"
      )}
      inert={!isOpen}
    >
      <div
        aria-hidden="true"
        onClick={closeBag}
        className={cn(
          "absolute inset-0 bg-black/20 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="bag-drawer-title"
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col bg-white shadow-float transition-transform duration-300 ease-hover",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <h2 id="bag-drawer-title" className="text-title font-semibold">
            Your bag{count > 0 ? ` (${count})` : ""}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={closeBag}
            aria-label="Close bag"
            className="grid size-8 place-items-center rounded-full hover:bg-surface"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 pt-2 pb-20">
          <BagContents variant="drawer" onNavigate={closeBag} />
        </div>
      </aside>
    </div>
  );
}
