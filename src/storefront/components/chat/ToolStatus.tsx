import { Loader2 } from "lucide-react";

/** `Searching the catalog…` line with a spinner while a tool runs. */
export function ToolStatus({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-caption text-text-secondary">
      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      {label}
    </p>
  );
}
