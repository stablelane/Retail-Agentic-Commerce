import "server-only";

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
