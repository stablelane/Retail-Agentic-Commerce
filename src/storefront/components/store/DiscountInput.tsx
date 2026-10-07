"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import type { AcpDiscounts } from "@/lib/commerce/acp";
import { formatCents } from "@/lib/money";

const CODE_PATTERN = /^[A-Z0-9_-]{1,32}$/;

interface DiscountInputProps {
  discounts: AcpDiscounts | null | undefined;
  disabled?: boolean;
  /** Replace the session's discount codes; rejects with a user-facing error. */
  onChangeCodes: (codes: string[]) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Couldn't update discount codes.";
}

export function DiscountInput({ discounts, disabled = false, onChangeCodes }: DiscountInputProps) {
  const inputId = useId();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applied = discounts?.applied ?? [];
  const appliedCodes = applied
    .map((discount) => discount.code)
    .filter((value): value is string => Boolean(value));
  const rejected = (discounts?.rejected ?? []).filter(
    (rejection) => !appliedCodes.includes(rejection.code)
  );

  async function submit(codes: string[]) {
    setPending(true);
    setError(null);
    try {
      await onChangeCodes(codes);
      setCode("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!CODE_PATTERN.test(normalized)) {
      setError("Enter a valid code (letters and numbers only).");
      return;
    }
    if (appliedCodes.includes(normalized)) {
      setError(`${normalized} is already applied.`);
      return;
    }
    void submit([...appliedCodes, normalized]);
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Discount code
        </label>
        <input
          id={inputId}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Discount code"
          autoComplete="off"
          maxLength={32}
          disabled={disabled || pending}
          className="h-10 min-w-0 flex-1 rounded-input border border-line px-3 text-small uppercase placeholder:normal-case placeholder:text-text-secondary disabled:opacity-60"
        />
        <button
          type="submit"
          className="btn-outline h-10 px-4"
          disabled={disabled || pending || code.trim() === ""}
        >
          {pending ? "Applying…" : "Apply"}
        </button>
      </form>

      {applied.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Applied discounts">
          {applied.map((discount) => (
            <li
              key={discount.id}
              className="flex items-center gap-1.5 rounded-pill bg-primary-soft/40 py-1 pr-1 pl-3 text-micro font-semibold text-primary"
            >
              {discount.code ?? discount.coupon.name} · −{formatCents(discount.amount)}
              {discount.code ? (
                <button
                  type="button"
                  aria-label={`Remove code ${discount.code}`}
                  disabled={disabled || pending}
                  onClick={() =>
                    void submit(appliedCodes.filter((value) => value !== discount.code))
                  }
                  className="grid size-5 place-items-center rounded-full hover:bg-white/60"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {rejected.map((rejection) => (
        <p key={rejection.code} className="text-micro text-text-secondary">
          {rejection.code}: {rejection.message ?? "This code can't be applied."}
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-micro text-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
