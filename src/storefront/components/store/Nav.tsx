"use client";

import { Menu, Search, ShoppingBag, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useChat } from "@/components/chat/ChatProvider";
import { useBag } from "@/components/store/BagProvider";
import { Logo } from "@/components/store/Logo";
import { cn } from "@/lib/cn";
import { cartItemCount, useCart } from "@/lib/commerce/cart-store";
import { HERO_ID } from "@/lib/content/home";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "What’s On" },
  { href: "/contact", label: "Contact" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();
  const { openChat } = useChat();
  const { openBag } = useBag();
  const bagCount = cartItemCount(useCart().items);
  const [heroVisible, setHeroVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(HERO_ID);
    if (!hero) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry?.isIntersecting ?? false),
      { rootMargin: "-56px 0px 0px 0px" }
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, [pathname]);

  const solid = !(pathname === "/" && heroVisible) || menuOpen;

  const linkClass = (href: string) =>
    cn(
      "transition-colors duration-300",
      isActive(pathname, href)
        ? solid
          ? "text-text"
          : "text-white"
        : solid
          ? "text-text-secondary hover:text-text"
          : "text-white/70 hover:text-white"
    );

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 border-b transition-colors duration-300",
        solid ? "border-border bg-white text-text" : "border-transparent bg-transparent text-white"
      )}
    >
      <nav
        aria-label="Main"
        className="mx-auto grid h-14 max-w-(--container-page) grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-8"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="-ml-1 grid size-9 place-items-center sm:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <Menu className="size-5" aria-hidden="true" />
            )}
          </button>
          <Link
            href="/"
            aria-label="Home"
            className={cn("transition-colors duration-300", solid ? "text-primary" : "text-white")}
          >
            <Logo />
          </Link>
        </div>

        <ul className="hidden items-center gap-4 text-small font-semibold sm:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={linkClass(link.href)}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-3.5">
          <button
            type="button"
            onClick={openChat}
            aria-label="Search with our AI"
            aria-haspopup="dialog"
            className="grid size-9 place-items-center sm:size-auto"
          >
            <Search className="size-5" aria-hidden="true" />
          </button>
          <Link
            href="/account"
            aria-label="Account"
            className="grid size-9 place-items-center sm:size-auto"
          >
            <User className="size-5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={openBag}
            aria-label={bagCount > 0 ? `Bag, ${bagCount} items` : "Bag"}
            aria-haspopup="dialog"
            className="relative grid size-9 place-items-center sm:size-auto"
          >
            <ShoppingBag className="size-5" aria-hidden="true" />
            {bagCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-white sm:-top-1.5 sm:-right-2"
              >
                {bagCount > 99 ? "99+" : bagCount}
              </span>
            ) : null}
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <ul
          id="mobile-menu"
          className="flex flex-col gap-1 border-t border-border bg-white px-4 pb-4 text-small font-semibold sm:hidden"
        >
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={cn("block py-3", linkClass(link.href))}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
