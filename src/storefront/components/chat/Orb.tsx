import { cn } from "@/lib/cn";

export function Orb({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("orb block shrink-0 animate-orb rounded-full", className)}
    />
  );
}
