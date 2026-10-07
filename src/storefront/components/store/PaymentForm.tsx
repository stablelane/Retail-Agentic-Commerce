import { FormField } from "@/components/store/FormField";

export interface CardFormValues {
  cardName: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvc: string;
}

interface PaymentFormProps {
  values: CardFormValues;
  errors: Partial<Record<keyof CardFormValues, string | undefined>>;
  onChange: (field: keyof CardFormValues, value: string) => void;
  disabled?: boolean;
}

/** Card fields; values are only ever sent to the PSP proxy for tokenization. */
export function PaymentForm({ values, errors, onChange, disabled = false }: PaymentFormProps) {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <legend className="mb-4 text-title font-semibold">Payment</legend>
      <p className="-mt-2 text-caption text-text-secondary">
        Demo checkout — use the test card. Card details go straight to the payment provider and are
        never stored by the store.
      </p>
      <FormField
        id="checkout-cardName"
        label="Name on card"
        value={values.cardName}
        onValueChange={(value) => onChange("cardName", value)}
        error={errors.cardName}
        autoComplete="cc-name"
        maxLength={256}
      />
      <FormField
        id="checkout-cardNumber"
        label="Card number"
        value={values.cardNumber}
        onValueChange={(value) => onChange("cardNumber", value)}
        error={errors.cardNumber}
        autoComplete="cc-number"
        inputMode="numeric"
        maxLength={23}
        spellCheck={false}
      />
      <div className="grid grid-cols-2 gap-4">
        <FormField
          id="checkout-cardExpiry"
          label="Expiry (MM/YY)"
          value={values.cardExpiry}
          onValueChange={(value) => onChange("cardExpiry", value)}
          error={errors.cardExpiry}
          autoComplete="cc-exp"
          inputMode="numeric"
          placeholder="MM/YY"
          maxLength={7}
        />
        <FormField
          id="checkout-cardCvc"
          label="CVC"
          value={values.cardCvc}
          onValueChange={(value) => onChange("cardCvc", value)}
          error={errors.cardCvc}
          autoComplete="cc-csc"
          inputMode="numeric"
          maxLength={4}
        />
      </div>
    </fieldset>
  );
}
