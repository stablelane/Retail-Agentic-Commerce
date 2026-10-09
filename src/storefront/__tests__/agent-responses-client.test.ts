// @vitest-environment node
import {
  LlmError,
  createLlmClient,
  withFallback,
  type LlmClient,
  type LlmStreamEvent,
} from "@/lib/agent/client";
import { buildResponsesRequest, responsesUrl } from "@/lib/agent/responses-client";
import { getFallbackLlmConfig, getLlmConfig, type LlmConfig } from "@/lib/env";

vi.mock("server-only", () => ({}));

const AZURE_BASE = "https://foundry.services.ai.azure.com/openai/v1";
const TOOL = {
  type: "function" as const,
  function: {
    name: "search_products",
    description: "Search the catalog",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
};

function config(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return {
    provider: "responses",
    apiKey: "azure-secret",
    baseUrl: AZURE_BASE,
    model: "gpt-5.3-codex",
    reasoningEffort: "low",
    timeoutMs: 5_000,
    maxToolSteps: 6,
    ...overrides,
  };
}

function sse(...events: Record<string, unknown>[]): Response {
  const text = events.map(
    (event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`
  );
  return new Response(text.join(""), { headers: { "content-type": "text/event-stream" } });
}

async function collect(stream: AsyncGenerator<LlmStreamEvent>): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getLlmConfig", () => {
  it("prefers Azure Responses when key and endpoint are set", () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "k");
    vi.stubEnv("AZURE_OPENAI_BASE_URL", AZURE_BASE);
    vi.stubEnv("AZURE_OPENAI_MODEL", "");
    vi.stubEnv("CHAT_LLM_PROVIDER", "");
    vi.stubEnv("CHAT_LLM_TIMEOUT_MS", "");
    expect(getLlmConfig()).toMatchObject({
      provider: "responses",
      model: "gpt-5.3-codex",
      timeoutMs: 60_000,
      reasoningEffort: "low",
    });
  });

  it("falls back to NIM without an Azure endpoint or when forced", () => {
    vi.stubEnv("AZURE_OPENAI_API_KEY", "k");
    vi.stubEnv("AZURE_OPENAI_BASE_URL", "");
    expect(getLlmConfig().provider).toBe("nim");
    vi.stubEnv("AZURE_OPENAI_BASE_URL", AZURE_BASE);
    vi.stubEnv("CHAT_LLM_PROVIDER", "nim");
    expect(getLlmConfig().provider).toBe("nim");
  });
});

describe("withFallback", () => {
  const request = { messages: [], tools: [], toolChoice: "auto" as const };

  function fake(events: LlmStreamEvent[], fail?: LlmError): LlmClient & { calls: number } {
    const client = {
      calls: 0,
      async *streamStep() {
        client.calls += 1;
        for (const event of events) yield event;
        if (fail) throw fail;
      },
    };
    return client;
  }

  it("switches to the backup when the primary fails before answering, and stays there", async () => {
    const primary = fake([], new LlmError("http", 403));
    const backup = fake([{ type: "text", delta: "from NIM" }]);
    const log = vi.fn();
    const llm = withFallback(primary, backup, log);

    expect(await collect(llm.streamStep(request))).toEqual([{ type: "text", delta: "from NIM" }]);
    await collect(llm.streamStep(request));
    expect(primary.calls).toBe(1);
    expect(backup.calls).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("403"));
  });

  it("does not switch once the primary has streamed output", async () => {
    const primary = fake([{ type: "text", delta: "partial" }], new LlmError("timeout"));
    const backup = fake([{ type: "text", delta: "backup" }]);
    await expect(collect(withFallback(primary, backup).streamStep(request))).rejects.toBeInstanceOf(
      LlmError
    );
    expect(backup.calls).toBe(0);
  });

  it("offers NIM as backup only for the Azure provider with an NVIDIA key", () => {
    vi.stubEnv("NVIDIA_API_KEY", "nv");
    vi.stubEnv("CHAT_LLM_FALLBACK", "");
    expect(getFallbackLlmConfig(config())?.provider).toBe("nim");
    expect(getFallbackLlmConfig(config({ provider: "nim" }))).toBeNull();
    vi.stubEnv("CHAT_LLM_FALLBACK", "off");
    expect(getFallbackLlmConfig(config())).toBeNull();
    vi.stubEnv("CHAT_LLM_FALLBACK", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    expect(getFallbackLlmConfig(config())).toBeNull();
  });
});

describe("responsesUrl", () => {
  it("accepts the API root or the full responses URL", () => {
    expect(responsesUrl(AZURE_BASE)).toBe(`${AZURE_BASE}/responses`);
    expect(responsesUrl(`${AZURE_BASE}/responses`)).toBe(`${AZURE_BASE}/responses`);
    expect(responsesUrl(`${AZURE_BASE}/`)).toBe(`${AZURE_BASE}/responses`);
  });
});

describe("buildResponsesRequest", () => {
  it("maps chat history, tool calls and tools to Responses input", () => {
    const body = buildResponsesRequest(config(), {
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "tees?" },
        {
          role: "assistant",
          content: "Looking.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "search_products", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"ok":true}' },
      ],
      tools: [TOOL],
      toolChoice: "auto",
    });

    expect(body.instructions).toBe("Be brief.");
    expect(body.input).toEqual([
      { role: "user", content: "tees?" },
      { role: "assistant", content: "Looking." },
      { type: "function_call", call_id: "call_1", name: "search_products", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' },
    ]);
    expect(body.tools[0]).toMatchObject({
      type: "function",
      name: "search_products",
      strict: false,
    });
    expect(body).toMatchObject({
      model: "gpt-5.3-codex",
      tool_choice: "auto",
      store: false,
      stream: true,
      reasoning: { effort: "low" },
    });
  });
});

describe("Responses client", () => {
  const request = {
    messages: [{ role: "user" as const, content: "hi" }],
    tools: [TOOL],
    toolChoice: "auto" as const,
  };

  it("streams text deltas and completed function calls with api-key auth", async () => {
    fetchMock.mockResolvedValueOnce(
      sse(
        { type: "response.created" },
        { type: "response.output_text.delta", delta: "Here " },
        { type: "response.output_text.delta", delta: "you go." },
        { type: "response.function_call_arguments.delta", delta: '{"query"' },
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            call_id: "call_9",
            name: "search_products",
            arguments: '{"query":"tee"}',
          },
        },
        { type: "response.completed" }
      )
    );

    const events = await collect(createLlmClient(config())!.streamStep(request));

    expect(events).toEqual([
      { type: "text", delta: "Here " },
      { type: "text", delta: "you go." },
      {
        type: "tool_calls",
        calls: [{ id: "call_9", name: "search_products", arguments: '{"query":"tee"}' }],
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${AZURE_BASE}/responses`);
    const headers = init?.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("azure-secret");
    expect(headers.authorization).toBeUndefined();
  });

  it("uses bearer auth for non-Azure hosts", async () => {
    fetchMock.mockResolvedValueOnce(sse({ type: "response.completed" }));
    await collect(
      createLlmClient(config({ baseUrl: "https://api.example.com/v1" }))!.streamStep(request)
    );
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer azure-secret");
  });

  it("maps HTTP errors without leaking the upstream body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad key azure-secret", { status: 401 }));
    const error = await collect(createLlmClient(config())!.streamStep(request)).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(401);
    expect((error as LlmError).message).not.toContain("azure-secret");
  });

  it("throws when the response fails mid-stream", async () => {
    fetchMock.mockResolvedValueOnce(
      sse({ type: "response.output_text.delta", delta: "Hi" }, { type: "response.failed" })
    );
    await expect(collect(createLlmClient(config())!.streamStep(request))).rejects.toBeInstanceOf(
      LlmError
    );
  });
});
