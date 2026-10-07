"use client";

import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";

import { useBlockActions } from "@/components/chat/blocks/BlockActions";
import type { OrderFormBlock as OrderFormBlockData } from "@/lib/agent/types";
import { isEmail, isOrderId } from "@/lib/commerce/orders";
import { MOCK_USER } from "@/lib/commerce/user";

interface FormErrors {
  orderId?: string;
  email?: string;
}

/** Inline order lookup (§2.11): `Order number | Email address` group + `Track Order ›`. */
export function OrderFormBlock({ block }: { block: OrderFormBlockData }) {
  const { send } = useBlockActions();
  const id = useId();
  const [orderId, setOrderId] = useState(block.prefill?.orderId ?? "");
  const [email, setEmail] = useState(block.prefill?.email || MOCK_USER.email);
  const [errors, setErrors] = useState<FormErrors>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedId = orderId.trim();
    const trimmedEmail = email.trim();
    const next: FormErrors = {};
    if (!isOrderId(trimmedId)) next.orderId = "Enter an order number like order_abc123.";
    if (!isEmail(trimmedEmail)) next.email = "Enter the email used at checkout.";
    setErrors(next);
    if (next.orderId) document.getElementById(`${id}-order`)?.focus();
    else if (next.email) document.getElementById(`${id}-email`)?.focus();
    else send(`Track order ${trimmedId} for ${trimmedEmail}`, "track_order");
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Track an order"
      className="flex flex-col gap-2"
    >
      <p className="text-small leading-normal">
        {block.reason === "not_found"
          ? "We couldn't find that order. Check the order number and email, then try again."
          : "Enter your order number and the email you used at checkout."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 w-full max-w-[333px] items-stretch overflow-hidden rounded-input border border-line text-caption">
          <input
            id={`${id}-order`}
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="Order number"
            aria-label="Order number"
            aria-invalid={errors.orderId ? true : undefined}
            {...(errors.orderId ? { "aria-describedby": `${id}-order-error` } : {})}
            autoComplete="off"
            spellCheck={false}
            maxLength={70}
            className="min-w-0 flex-1 bg-white px-3 placeholder:text-text-secondary focus:outline-none focus-visible:bg-surface"
          />
          <span aria-hidden="true" className="w-px bg-line" />
          <input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            aria-label="Email address"
            aria-invalid={errors.email ? true : undefined}
            {...(errors.email ? { "aria-describedby": `${id}-email-error` } : {})}
            autoComplete="email"
            maxLength={256}
            className="min-w-0 flex-1 bg-white px-3 placeholder:text-text-secondary focus:outline-none focus-visible:bg-surface"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1 rounded-input border border-line px-4 text-caption font-semibold text-primary"
        >
          Track Order
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {errors.orderId ? (
        <p id={`${id}-order-error`} className="text-micro text-text">
          {errors.orderId}
        </p>
      ) : null}
      {errors.email ? (
        <p id={`${id}-email-error`} className="text-micro text-text">
          {errors.email}
        </p>
      ) : null}
    </form>
  );
}
