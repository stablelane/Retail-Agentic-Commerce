import type { Metadata } from "next";

import { CheckoutForm } from "@/components/store/CheckoutForm";

export const metadata: Metadata = { title: "Checkout" };

export default function CheckoutPage() {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-page) pt-12 pb-16">
        <h1 className="font-serif text-h2 leading-[1.1] font-normal">Checkout</h1>
        <div className="mt-8">
          <CheckoutForm />
        </div>
      </div>
    </div>
  );
}
