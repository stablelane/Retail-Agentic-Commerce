"use client";

import { AccountSummaryBlock } from "@/components/chat/blocks/AccountSummaryBlock";
import { CartSummaryBlock } from "@/components/chat/blocks/CartSummaryBlock";
import { CheckoutPanelBlock } from "@/components/chat/blocks/CheckoutPanelBlock";
import { NotificationBlock } from "@/components/chat/blocks/NotificationBlock";
import { OrderFormBlock } from "@/components/chat/blocks/OrderFormBlock";
import { OrderStatusBlock } from "@/components/chat/blocks/OrderStatusBlock";
import { ProductCarouselBlock } from "@/components/chat/blocks/ProductCarouselBlock";
import { UpiMandateBlock } from "@/components/chat/blocks/UpiMandateBlock";
import { UpiPaymentBlock } from "@/components/chat/blocks/UpiPaymentBlock";
import type { UIBlock } from "@/lib/agent/types";
import { isRenderableBlock } from "@/lib/chat/session";

/** Render one UI block (§5.4); unknown or malformed blocks render nothing. */
export function BlockRenderer({ block }: { block: unknown }) {
  if (!isRenderableBlock(block)) return null;
  const typed: UIBlock = block;
  switch (typed.type) {
    case "product_carousel":
      return <ProductCarouselBlock block={typed} />;
    case "cart_summary":
      return <CartSummaryBlock block={typed} />;
    case "checkout_panel":
      return <CheckoutPanelBlock block={typed} />;
    case "order_form":
      return <OrderFormBlock block={typed} />;
    case "order_status":
      return <OrderStatusBlock block={typed} />;
    case "account_summary":
      return <AccountSummaryBlock block={typed} />;
    case "notification":
      return <NotificationBlock block={typed} />;
    case "upi_mandate":
      return <UpiMandateBlock block={typed} />;
    case "upi_payment":
      return <UpiPaymentBlock block={typed} />;
  }
}
