import { cn } from "@/lib/cn";

interface FormFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "id" | "value" | "onChange"
> {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string | undefined;
  optional?: boolean;
  className?: string;
}

export const INPUT_CLASS =
  "h-11 w-full rounded-input border border-line bg-white px-3 text-body aria-invalid:border-primary disabled:opacity-60";

/** Labelled text input with an inline, programmatically associated error. */
export function FormField({
  id,
  label,
  value,
  onValueChange,
  error,
  optional = false,
  className,
  ...inputProps
}: FormFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-small font-semibold">
        {label}
        {optional ? <span className="font-normal text-text-secondary"> (optional)</span> : null}
      </label>
      <input
        {...inputProps}
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        required={!optional}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
      />
      {error ? (
        <p id={errorId} className="text-micro text-primary">
          {error}
        </p>
      ) : null}
    </div>
  );
}
