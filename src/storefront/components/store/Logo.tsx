import { BRAND_NAME } from "@/lib/brand";

export function Logo() {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="logo-mark size-6" />
      <span className="text-[18px] leading-none font-bold tracking-[-0.01em]">{BRAND_NAME}</span>
    </span>
  );
}
