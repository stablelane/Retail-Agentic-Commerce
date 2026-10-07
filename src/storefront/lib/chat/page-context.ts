import type { ChatContext, ChatPage } from "@/lib/agent/types";
import { ORDER_ID, PRODUCT_ID } from "@/lib/commerce/proxy-allowlist";

const SECTION_PAGES: Record<string, ChatPage> = {
  catalog: "shop",
  products: "pdp",
  bag: "bag",
  checkout: "checkout",
  orders: "orders",
  account: "account",
  contact: "contact",
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

/** Map the current route to the chat `context` (§5.1); unknown routes count as `home`. */
export function chatContextFromPath(pathname: string | null | undefined): ChatContext {
  const [section = "", id = ""] = (pathname ?? "/").split("/").filter(Boolean);
  const page = SECTION_PAGES[section] ?? "home";
  const detail = decodeSegment(id);
  if (page === "pdp" && PRODUCT_ID.test(detail)) return { page, productId: detail };
  if (page === "orders" && ORDER_ID.test(detail)) return { page, orderId: detail };
  return { page };
}
