/** Section heading above a chat block: 15px title + optional 12px subtitle. */
export function BlockHeading({
  title,
  subtitle,
}: {
  title?: string | undefined;
  subtitle?: string | undefined;
}) {
  if (!title && !subtitle) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {title ? <h3 className="text-[15px] font-semibold text-text">{title}</h3> : null}
      {subtitle ? <p className="text-micro text-text-secondary">{subtitle}</p> : null}
    </div>
  );
}
