"use client";

import type { AcpFulfillmentOption } from "@/lib/commerce/acp";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";

interface ShippingSelectorProps {
  options: readonly AcpFulfillmentOption[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (optionId: string) => void;
  name?: string;
}

export function ShippingSelector({
  options,
  selectedId,
  disabled = false,
  onSelect,
  name = "fulfillment-option",
}: ShippingSelectorProps) {
  if (options.length === 0) return null;

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-small font-semibold">Tickets</legend>
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-input border px-3 py-2.5 transition-colors",
              selected ? "border-primary bg-primary-soft/30" : "border-line hover:border-black/30",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={selected}
              onChange={() => onSelect(option.id)}
              className="accent-primary"
            />
            <span className="flex flex-1 flex-col">
              <span className="text-small font-semibold">
                {option.title}
                {" · "}
                {option.total === 0 ? "Free" : formatCents(option.total)}
              </span>
              <span className="text-micro text-text-secondary">
                {option.subtitle}
                {option.carrier_info ? ` · ${option.carrier_info}` : ""}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
