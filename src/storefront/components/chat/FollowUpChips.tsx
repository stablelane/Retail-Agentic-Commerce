"use client";

export function FollowUpChips({
  chips,
  onPick,
}: {
  chips: readonly string[];
  onPick: (chip: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Follow-up suggestions" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip}>
          <button type="button" onClick={() => onPick(chip)} className="btn-outline">
            {chip}
          </button>
        </li>
      ))}
    </ul>
  );
}
