"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormField } from "@/components/store/FormField";
import { isEmail, isOrderId, orderHref } from "@/lib/commerce/orders";
import { MOCK_USER } from "@/lib/commerce/user";

interface OrderLookupFormProps {
  defaultOrderId?: string;
  defaultEmail?: string;
}

interface LookupErrors {
  orderId?: string | undefined;
  email?: string | undefined;
}

export function OrderLookupForm({
  defaultOrderId = "",
  defaultEmail = MOCK_USER.email,
}: OrderLookupFormProps) {
  const router = useRouter();
  const [orderId, setOrderId] = useState(defaultOrderId);
  const [email, setEmail] = useState(defaultEmail);
  const [errors, setErrors] = useState<LookupErrors>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedId = orderId.trim();
    const trimmedEmail = email.trim();
    const next: LookupErrors = {};
    if (!isOrderId(trimmedId)) next.orderId = "Enter an order ID like order_abc123.";
    if (!isEmail(trimmedEmail)) next.email = "Enter the email used at checkout.";
    setErrors(next);
    if (next.orderId) document.getElementById("lookup-orderId")?.focus();
    else if (next.email) document.getElementById("lookup-email")?.focus();
    else router.push(orderHref(trimmedId, trimmedEmail));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormField
        id="lookup-orderId"
        label="Order ID"
        value={orderId}
        onValueChange={setOrderId}
        error={errors.orderId}
        placeholder="order_…"
        autoComplete="off"
        spellCheck={false}
        maxLength={70}
      />
      <FormField
        id="lookup-email"
        label="Email"
        type="email"
        value={email}
        onValueChange={setEmail}
        error={errors.email}
        autoComplete="email"
        maxLength={256}
      />
      <button type="submit" className="btn-pill self-start">
        Track order
      </button>
    </form>
  );
}
