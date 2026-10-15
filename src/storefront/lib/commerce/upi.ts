import "server-only";

import { getPspConfig } from "@/lib/env";

/** Server-side client for the PSP's UPI wallet routes (feature 20). Amounts are paise. */

export const MOBILE = /^[6-9]\d{9}$/;
export const MANDATE_ID = /^[A-Za-z0-9_-]{1,80}$/;

const REQUEST_TIMEOUT_MS = 15_000;
// The PSP waits on the merchant, which waits on the Pine Labs capture.
const PAY_TIMEOUT_MS = 90_000;

export interface UpiMandate {
  id: string;
  mobile: string;
  amount: number;
  amount_available: number;
  status: string;
  deep_link: string | null;
  expires_at: string | null;
}

export type UpiPayResult =
  | {
      status: "paid";
      order_id: string | null;
      receipt: string | null;
      total: number | null;
      currency: "INR";
      spent_today: number;
    }
  | { status: "pending"; detail: unknown }
  | { status: "refused"; reason: string }
  | { status: "failed"; code: string; detail: unknown };

export class PspApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(`PSP responded with ${status} ${code}`);
    this.name = "PspApiError";
  }
}

async function pspFetch<T>(
  method: "GET" | "POST",
  path: string,
  {
    body,
    query,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }: {
    body?: unknown;
    query?: URLSearchParams;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { baseUrl, apiKey } = getPspConfig();
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + path;
  if (query) url.search = query.toString();

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PspApiError(502, "psp_unreachable");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      detail?: { code?: unknown };
    } | null;
    const code = payload?.detail?.code;
    throw new PspApiError(response.status, typeof code === "string" ? code : "psp_error");
  }
  return (await response.json()) as T;
}

export function createMandate(mobile: string, amount: number): Promise<UpiMandate> {
  return pspFetch<UpiMandate>("POST", "/upi/mandates", { body: { mobile, amount } });
}

/** Resolves to null when the shopper has no active mandate. */
export async function getActiveMandate(mobile: string): Promise<UpiMandate | null> {
  try {
    return await pspFetch<UpiMandate>("GET", "/upi/mandates", {
      query: new URLSearchParams({ mobile }),
    });
  } catch (error) {
    if (error instanceof PspApiError && error.code === "mandate_required") return null;
    throw error;
  }
}

export function payWithUpi(checkoutSessionId: string, mobile: string): Promise<UpiPayResult> {
  return pspFetch<UpiPayResult>("POST", "/upi/pay", {
    body: { checkout_session_id: checkoutSessionId, mobile },
    timeoutMs: PAY_TIMEOUT_MS,
  });
}
