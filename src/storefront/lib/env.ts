import "server-only";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT_ENV_KEY =
  /^(MERCHANT_API_(URL|KEY)|PSP_API_(URL|KEY)|MCP_SERVER_URL|WEBHOOK_SECRET|STRIPE_(SECRET|PUBLISHABLE)_KEY|NVIDIA_API_KEY|NIM_LLM_[A-Z_]+|AZURE_OPENAI_[A-Z_]+|CHAT_[A-Z_]+)$/;

/**
 * Local runs: fill missing or empty storefront settings from the repo-root .env so a plain
 * `pnpm start` works. Non-empty environment values always win; no-op when the file is absent.
 */
function loadRootEnv(): void {
  if (process.env.VITEST) return;
  const file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "../../.env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    const key = match?.[1];
    if (!key || !ROOT_ENV_KEY.test(key) || process.env[key]?.trim()) continue;
    process.env[key] = (match[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadRootEnv();

export interface UpstreamConfig {
  baseUrl: string;
  apiKey: string | undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getMerchantConfig(): UpstreamConfig {
  return {
    baseUrl: nonEmpty(process.env.MERCHANT_API_URL) ?? "http://localhost:8000",
    apiKey: nonEmpty(process.env.MERCHANT_API_KEY),
  };
}

export function getPspConfig(): UpstreamConfig {
  return {
    baseUrl: nonEmpty(process.env.PSP_API_URL) ?? "http://localhost:8001",
    apiKey: nonEmpty(process.env.PSP_API_KEY),
  };
}

export function getApiVersion(): string {
  return nonEmpty(process.env.NEXT_PUBLIC_API_VERSION) ?? "2026-01-16";
}

export function getMcpServerUrl(): string {
  return nonEmpty(process.env.MCP_SERVER_URL) ?? "http://localhost:2091";
}

/** HMAC secret shared with the merchant's webhook sender; when unset every delivery is rejected. */
export function getWebhookSecret(): string | undefined {
  return nonEmpty(process.env.WEBHOOK_SECRET);
}

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
}

/** Both keys are required; otherwise chat checkout falls back to the /checkout page. */
export function getStripeConfig(): StripeConfig | null {
  const secretKey = nonEmpty(process.env.STRIPE_SECRET_KEY);
  const publishableKey = nonEmpty(process.env.STRIPE_PUBLISHABLE_KEY);
  return secretKey && publishableKey ? { secretKey, publishableKey } : null;
}

export type LlmProvider = "nim" | "responses";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  /** Responses API only. */
  reasoningEffort: string;
  timeoutMs: number;
  maxToolSteps: number;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

/**
 * Azure OpenAI (Responses API) when its key and endpoint are set, otherwise the NIM
 * OpenAI-compatible endpoint. `CHAT_LLM_PROVIDER=nim` forces NIM. An empty key forces
 * the deterministic router.
 */
export function getLlmConfig(): LlmConfig {
  const maxToolSteps = boundedInt(process.env.CHAT_MAX_TOOL_STEPS, 6, 1, 10);
  const azureKey = nonEmpty(process.env.AZURE_OPENAI_API_KEY);
  const azureBaseUrl = nonEmpty(process.env.AZURE_OPENAI_BASE_URL);
  const forced = nonEmpty(process.env.CHAT_LLM_PROVIDER)?.toLowerCase();

  if (forced !== "nim" && azureKey && azureBaseUrl) {
    const effort = nonEmpty(process.env.CHAT_LLM_REASONING_EFFORT)?.toLowerCase() ?? "low";
    return {
      provider: "responses",
      apiKey: azureKey,
      baseUrl: azureBaseUrl,
      model: nonEmpty(process.env.AZURE_OPENAI_MODEL) ?? "gpt-5.3-codex",
      reasoningEffort: REASONING_EFFORTS.has(effort) ? effort : "low",
      timeoutMs: boundedInt(process.env.CHAT_LLM_TIMEOUT_MS, 60_000, 1_000, 120_000),
      maxToolSteps,
    };
  }

  return nimConfig(maxToolSteps);
}

function nimConfig(maxToolSteps: number): LlmConfig {
  return {
    provider: "nim",
    apiKey: nonEmpty(process.env.NVIDIA_API_KEY),
    baseUrl: nonEmpty(process.env.NIM_LLM_BASE_URL) ?? "https://integrate.api.nvidia.com/v1",
    model: nonEmpty(process.env.NIM_LLM_MODEL_NAME) ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
    reasoningEffort: "low",
    timeoutMs: boundedInt(process.env.CHAT_LLM_TIMEOUT_MS, 20_000, 1_000, 120_000),
    maxToolSteps,
  };
}

/**
 * NIM backup used when the Azure provider fails before answering (e.g. 403 from a
 * network-restricted resource). Null when Azure is not primary, NIM has no key, or
 * `CHAT_LLM_FALLBACK=off`.
 */
export function getFallbackLlmConfig(primary: LlmConfig): LlmConfig | null {
  if (primary.provider !== "responses") return null;
  if (nonEmpty(process.env.CHAT_LLM_FALLBACK)?.toLowerCase() === "off") return null;
  const fallback = nimConfig(primary.maxToolSteps);
  return fallback.apiKey ? fallback : null;
}
