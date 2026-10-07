import { cn } from "@/lib/cn";

export function SectionTitle({
  children,
  as: Tag = "h2",
  id,
  className,
}: {
  children: React.ReactNode;
  as?: "h1" | "h2";
  id?: string;
  className?: string;
}) {
  return (
    <Tag id={id} className={cn("text-title font-semibold text-text", className)}>
      {children}
    </Tag>
  );
}
