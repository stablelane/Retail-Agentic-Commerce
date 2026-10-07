import Link from "next/link";

import { Logo } from "@/components/store/Logo";
import { BRAND_NAME } from "@/lib/brand";

export function Footer() {
  return (
    <footer className="mt-16 bg-black px-4 py-8 pb-20 text-white sm:px-8">
      <div className="mx-auto flex max-w-(--container-page) flex-wrap items-center justify-between gap-4">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>
        <nav aria-label="Footer" className="flex gap-4 text-small font-semibold">
          <Link href="/catalog" className="text-white/70 hover:text-white">
            Catalog
          </Link>
          <Link href="/contact" className="text-white/70 hover:text-white">
            Contact
          </Link>
          <Link href="/orders" className="text-white/70 hover:text-white">
            Orders
          </Link>
        </nav>
        <p className="text-caption text-white/70">
          © {new Date().getFullYear()} {BRAND_NAME}. Demo storefront.
        </p>
      </div>
    </footer>
  );
}
