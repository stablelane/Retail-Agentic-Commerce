"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormField, INPUT_CLASS } from "@/components/store/FormField";
import { PaymentForm, type CardFormValues } from "@/components/store/PaymentForm";
import { ShippingSelector } from "@/components/store/ShippingSelector";
import { TotalsBlock } from "@/components/store/TotalsBlock";
import { AcpRequestError, findTotal, type AcpBuyerInput } from "@/lib/commerce/acp";
import { cartStore, cartSubtotal, useCart } from "@/lib/commerce/cart-store";
import {
  CheckoutError,
  LANGUAGES,
  placeOrder,
  type CheckoutStep,
  type Language,
} from "@/lib/commerce/checkout";
import { isEmail, orderHref } from "@/lib/commerce/orders";
import { DEMO_CARD, normalizeCardNumber, parseExpiry, type CardDetails } from "@/lib/commerce/psp";
import { saveRecentOrder } from "@/lib/commerce/recent-orders";
import { getSessionSyncer } from "@/lib/commerce/session-sync";
import { MOCK_BUYER, MOCK_USER_ADDRESS } from "@/lib/commerce/user";
import { formatCents } from "@/lib/money";

interface CheckoutFormValues extends CardFormValues {
  firstName: string;
  lastName: string;
  email: string;
  name: string;
  lineOne: string;
  lineTwo: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

type FieldName = keyof CheckoutFormValues;
type FieldErrors = Partial<Record<FieldName, string | undefined>>;

const DEMO_PREFILL = process.env.NEXT_PUBLIC_DEMO_PREFILL !== "false";

const INITIAL_VALUES: CheckoutFormValues = {
  firstName: MOCK_BUYER.first_name,
  lastName: MOCK_BUYER.last_name,
  email: MOCK_BUYER.email,
  name: MOCK_USER_ADDRESS.name,
  lineOne: MOCK_USER_ADDRESS.line_one,
  lineTwo: "",
  city: MOCK_USER_ADDRESS.city,
  state: MOCK_USER_ADDRESS.state,
  postalCode: MOCK_USER_ADDRESS.postal_code,
  country: MOCK_USER_ADDRESS.country,
  cardName: DEMO_PREFILL ? MOCK_USER_ADDRESS.name : "",
  cardNumber: DEMO_PREFILL ? DEMO_CARD.number : "",
  cardExpiry: DEMO_PREFILL ? DEMO_CARD.expiry : "",
  cardCvc: DEMO_PREFILL ? DEMO_CARD.cvc : "",
};

const FIELD_ORDER: readonly FieldName[] = [
  "firstName",
  "lastName",
  "email",
  "cardName",
  "cardNumber",
  "cardExpiry",
  "cardCvc",
];

const STEP_LABEL: Record<CheckoutStep, string> = {
  updating: "Confirming your details…",
  authorizing: "Authorizing payment…",
  completing: "Placing your order…",
};

type Validated =
  { ok: true; buyer: AcpBuyerInput; card: CardDetails } | { ok: false; errors: FieldErrors };

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function validate(values: CheckoutFormValues, now: Date): Validated {
  const errors: FieldErrors = {};
  const text = (field: FieldName) => values[field].trim();
  const requireText = (field: FieldName, message: string, max: number) => {
    const value = text(field);
    if (!value) errors[field] = message;
    else if (value.length > max) errors[field] = `Use ${max} characters or fewer.`;
  };

  requireText("firstName", "Enter your first name.", 256);
  if (text("lastName").length > 256) errors.lastName = "Use 256 characters or fewer.";
  if (!isEmail(text("email"))) errors.email = "Enter a valid email address.";

  requireText("cardName", "Enter the name on the card.", 256);
  const number = normalizeCardNumber(values.cardNumber);
  if (!/^\d{13,19}$/.test(number) || !passesLuhn(number)) {
    errors.cardNumber = "Enter a valid card number.";
  }
  const expiry = parseExpiry(values.cardExpiry);
  const expired =
    expiry !== null &&
    Number(expiry.expYear) * 12 + Number(expiry.expMonth) <
      now.getFullYear() * 12 + now.getMonth() + 1;
  if (!expiry) errors.cardExpiry = "Enter the expiry as MM/YY.";
  else if (expired) errors.cardExpiry = "This card has expired.";
  if (!/^\d{3,4}$/.test(values.cardCvc.trim())) errors.cardCvc = "Enter the 3 or 4 digit code.";

  if (Object.keys(errors).length > 0 || !expiry) return { ok: false, errors };

  const lastName = text("lastName");
  return {
    ok: true,
    buyer: {
      first_name: text("firstName"),
      ...(lastName ? { last_name: lastName } : {}),
      email: text("email"),
    },
    card: { number, ...expiry },
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof CheckoutError) return error.message;
  if (error instanceof AcpRequestError) {
    if (error.status === 0) return error.message;
    if (error.status === 422 || error.message.startsWith("Request failed")) {
      return "We couldn't place your order. Please check your details and try again.";
    }
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "We couldn't place your order. Please try again.";
}

export function CheckoutForm() {
  const router = useRouter();
  const cart = useCart();
  const [values, setValues] = useState<CheckoutFormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [language, setLanguage] = useState<Language>("en");
  const [step, setStep] = useState<CheckoutStep | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);

  const pending = step !== null;

  if (placedOrderId) {
    return (
      <p role="status" className="text-body">
        Order {placedOrderId} placed. Taking you to your order…
      </p>
    );
  }

  if (!cart.hydrated) {
    return <p className="text-small text-text-secondary">Loading your bag…</p>;
  }

  if (cart.items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-body">Your bag is empty.</p>
        <Link href="/catalog" className="btn-pill">
          Browse the catalog
        </Link>
      </div>
    );
  }

  const session = cart.session;
  const linesByProduct = new Map(session?.line_items.map((line) => [line.item.id, line]));
  const syncing = cart.syncStatus === "syncing";

  function setField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function field(name: FieldName) {
    return {
      id: `checkout-${name}`,
      value: values[name],
      onValueChange: (value: string) => setField(name, value),
      error: errors[name],
    };
  }

  async function selectShipping(optionId: string) {
    setShippingError(null);
    try {
      await getSessionSyncer().updateSession({ fulfillment_option_id: optionId });
    } catch {
      setShippingError("Couldn't update the delivery option. Please try again.");
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFormError(null);

    const result = validate(values, new Date());
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((name) => result.errors[name]);
      if (first) document.getElementById(`checkout-${first}`)?.focus();
      return;
    }
    setErrors({});
    setStep("updating");

    try {
      const placed = await getSessionSyncer().withSyncedSession((current) =>
        placeOrder({
          session: current,
          buyer: result.buyer,
          card: result.card,
          language,
          onStep: setStep,
        })
      );
      saveRecentOrder({
        id: placed.orderId,
        email: result.buyer.email,
        placedAt: new Date().toISOString(),
        total: findTotal(placed.session.totals, "total"),
      });
      setPlacedOrderId(placed.orderId);
      cartStore.clear();
      router.push(orderHref(placed.orderId, result.buyer.email, true));
    } catch (error) {
      setFormError(errorMessage(error));
      setStep(null);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      className="grid items-start gap-8 lg:grid-cols-[1fr_400px]"
    >
      <div className="flex flex-col gap-10">
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <legend className="mb-4 text-title font-semibold">Contact</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              {...field("firstName")}
              label="First name"
              autoComplete="given-name"
              maxLength={256}
            />
            <FormField
              {...field("lastName")}
              label="Last name"
              optional
              autoComplete="family-name"
              maxLength={256}
            />
          </div>
          <FormField
            {...field("email")}
            label="Email"
            type="email"
            autoComplete="email"
            maxLength={256}
          />
        </fieldset>

        <section aria-labelledby="checkout-delivery-heading" className="flex flex-col gap-2">
          <h2 id="checkout-delivery-heading" className="text-title font-semibold">
            Tickets
          </h2>
          {session ? (
            <ShippingSelector
              options={session.fulfillment_options}
              selectedId={session.fulfillment_option_id}
              disabled={pending || syncing}
              onSelect={(optionId) => void selectShipping(optionId)}
              name="checkout-fulfillment-option"
            />
          ) : (
            <p className="text-small text-text-secondary">Loading delivery options…</p>
          )}
          {shippingError ? (
            <p role="alert" className="text-micro text-text">
              {shippingError}
            </p>
          ) : null}
        </section>

        <PaymentForm values={values} errors={errors} onChange={setField} disabled={pending} />
      </div>

      <section
        aria-labelledby="checkout-review-heading"
        className="flex flex-col gap-5 rounded-card bg-surface p-6 lg:sticky lg:top-22"
      >
        <h2 id="checkout-review-heading" className="text-title font-semibold">
          Review
        </h2>
        <ul className="divide-y divide-line">
          {cart.items.map((item) => {
            const line = linesByProduct.get(item.id);
            return (
              <li key={item.id} className="flex justify-between gap-4 py-2 text-small">
                <span className="min-w-0">
                  <span className="font-semibold">{item.name}</span>
                  <span className="text-text-secondary"> × {item.quantity}</span>
                </span>
                <span className="font-semibold">
                  {formatCents(line?.subtotal ?? item.price * item.quantity)}
                </span>
              </li>
            );
          })}
        </ul>
        <TotalsBlock totals={session?.totals ?? null} fallbackSubtotal={cartSubtotal(cart.items)} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="checkout-language" className="text-small font-semibold">
            Order updates language
          </label>
          <select
            id="checkout-language"
            value={language}
            onChange={(event) => {
              const next = LANGUAGES.find((option) => option.id === event.target.value);
              if (next) setLanguage(next.id);
            }}
            disabled={pending}
            className={INPUT_CLASS}
          >
            {LANGUAGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {formError ? (
          <p role="alert" className="rounded-input bg-white p-3 text-small text-text">
            {formError}
          </p>
        ) : null}
        <p role="status" className="sr-only">
          {step ? STEP_LABEL[step] : ""}
        </p>

        <button type="submit" className="btn-pill w-full" disabled={pending}>
          {step ? STEP_LABEL[step] : "Place order"}
        </button>
        <Link href="/bag" className="text-center text-caption text-text-secondary underline">
          Edit bag
        </Link>
      </section>
    </form>
  );
}
