import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { ChatProvider, useChat } from "@/components/chat/ChatProvider";
import { BagProvider, useBag } from "@/components/store/BagProvider";
import { CHAT_STORAGE_KEY } from "@/lib/chat/session";
import { cartStore } from "@/lib/commerce/cart-store";

vi.mock("next/navigation", () => ({
  usePathname: () => "/products/prod_1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/commerce/session-sync", () => ({
  getSessionSyncer: () => ({ start: () => () => undefined }),
}));

const encoder = new TextEncoder();
const fetchMock = vi.fn<typeof fetch>();

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sse(...frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of frames) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function chatBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/chat")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

function BagState() {
  const { isOpen } = useBag();
  return <p data-testid="bag-state">{isOpen ? "bag open" : "bag closed"}</p>;
}

function Notifier() {
  const { notify } = useChat();
  return (
    <button
      type="button"
      onClick={() =>
        notify({
          type: "notification",
          subject: "On its way",
          message: "Your order shipped.",
          status: "order_shipped",
          orderId: "order_1",
          trackingUrl: null,
          receivedAt: "2026-01-01T10:00:00Z",
        })
      }
    >
      Simulate webhook
    </button>
  );
}

function renderChat() {
  return render(
    <ChatProvider>
      <BagProvider>
        <Notifier />
        <BagState />
        <ChatLauncher />
        <ChatOverlay />
      </BagProvider>
    </ChatProvider>
  );
}

function launcher() {
  return screen.getByRole("button", { name: /Chat with our AI/, hidden: true });
}

function composer() {
  return screen.getByRole("textbox", { name: "Message the shopping assistant" });
}

beforeEach(() => {
  window.sessionStorage.clear();
  cartStore.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat overlay", () => {
  it("opens from the launcher, focuses the composer and closes on Escape", () => {
    renderChat();
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("inert");

    fireEvent.click(launcher());
    const dialog = screen.getByRole("dialog", { name: "Shopping assistant" });
    expect(dialog).not.toHaveAttribute("inert");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(launcher().closest("[hidden]")).not.toBeNull();
    expect(composer()).toHaveFocus();
    expect(composer()).toHaveAttribute("placeholder", "What can I help you with today?");
    expect(within(dialog).getByText("Hi, how can I help you?")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("inert");
    expect(launcher().closest("[hidden]")).toBeNull();
    expect(launcher()).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("toggles with Cmd/Ctrl+K", () => {
    renderChat();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).not.toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "K", ctrlKey: true });
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("inert");
  });

  it("sends a chip with its intent and page context, then renders the streamed card", async () => {
    fetchMock.mockResolvedValue(
      sse(
        frame("tool_status", { tool: "track_order", label: "Checking your order…" }),
        frame("text", { delta: "Enter your order number " }),
        frame("text", { delta: "and email." }),
        frame("block", { type: "order_form", prefill: { email: "john@example.com" } }),
        frame("suggestions", { chips: ["View my bag", "Help me choose"] }),
        frame("done", { steps: 1, fallback: true })
      )
    );
    renderChat();
    fireEvent.click(launcher());
    fireEvent.click(screen.getByRole("button", { name: "Track my order" }));

    expect(chatBodies()[0]).toEqual({
      messages: [{ role: "user", content: "Track my order" }],
      cart: { sessionId: null, items: [] },
      context: { page: "pdp", productId: "prod_1" },
      intent: "track_order",
    });

    const card = await screen.findByRole("article", { name: "Track my order" });
    expect(await within(card).findByText("Enter your order number and email.")).toBeInTheDocument();
    expect(within(card).getByRole("form", { name: "Track an order" })).toBeInTheDocument();
    expect(await within(card).findByRole("button", { name: "View my bag" })).toBeInTheDocument();
    expect(within(card).getByRole("group", { name: "Rate this answer" })).toBeInTheDocument();
    expect(composer()).toHaveAttribute("placeholder", "Need more details?");
    expect(composer()).toHaveFocus();
  });

  it("sends typed messages on Enter with history, and keeps Shift+Enter as a newline", async () => {
    fetchMock.mockImplementation(async () =>
      sse(frame("text", { delta: "Sure." }), frame("done", { steps: 0, fallback: true }))
    );
    renderChat();
    fireEvent.click(launcher());

    fireEvent.change(composer(), { target: { value: "Show me tops" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(composer()).toHaveValue("");
    await screen.findByText("Sure.");
    await waitFor(() => expect(composer()).not.toHaveAttribute("readonly"));

    fireEvent.change(composer(), { target: { value: "Cheaper ones?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("article", { name: "Cheaper ones?" });
    // The earlier question and answer stay in the thread.
    expect(screen.getByRole("article", { name: "Show me tops" })).toHaveTextContent("Sure.");

    expect(chatBodies()[1]?.messages).toEqual([
      { role: "user", content: "Show me tops" },
      { role: "assistant", content: "Sure." },
      { role: "user", content: "Cheaper ones?" },
    ]);
  });

  it("New chat clears the thread and the saved conversation", async () => {
    fetchMock.mockImplementation(async () =>
      sse(frame("text", { delta: "Sure." }), frame("done", { steps: 0, fallback: true }))
    );
    renderChat();
    fireEvent.click(launcher());
    fireEvent.change(composer(), { target: { value: "Show me tops" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await screen.findByText("Sure.");
    await waitFor(() => expect(window.sessionStorage.getItem(CHAT_STORAGE_KEY)).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(screen.queryByRole("article", { name: "Show me tops" })).not.toBeInTheDocument();
    expect(screen.getByText("Hi, how can I help you?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to conversation" })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(CHAT_STORAGE_KEY)).toBeNull();
    expect(composer()).toHaveFocus();

    fireEvent.change(composer(), { target: { value: "Fresh start" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await screen.findByRole("article", { name: "Fresh start" });
    expect(chatBodies()[1]?.messages).toEqual([{ role: "user", content: "Fresh start" }]);
  });

  it("applies cart_update to the cart store once and offers View bag", async () => {
    cartStore.add({ id: "prod_2", name: "Old", price: 1000, imageUrl: "/prod_2.jpeg" }, 1);
    const add = vi.spyOn(cartStore, "add");
    fetchMock.mockResolvedValue(
      sse(
        frame("cart_update", {
          sessionId: null,
          items: [
            {
              id: "prod_3",
              name: "Graphic Tee",
              price: 3200,
              imageUrl: "/prod_3.jpeg",
              quantity: 2,
              maxQuantity: 10,
            },
          ],
        }),
        frame("text", { delta: "Added." }),
        frame("done", { steps: 1, fallback: false })
      )
    );
    renderChat();
    fireEvent.click(launcher());
    fireEvent.change(composer(), { target: { value: "Add two Graphic Tees" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    expect(chatBodies()[0]?.cart).toEqual({
      sessionId: null,
      items: [{ id: "prod_2", quantity: 1 }],
    });
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Bag updated — 2 items.");
    await screen.findByText("Added.");

    expect(add).toHaveBeenCalledTimes(1);
    expect(cartStore.getSnapshot().items.map(({ id, quantity }) => ({ id, quantity }))).toEqual([
      { id: "prod_3", quantity: 2 },
    ]);

    fireEvent.click(within(notice).getByRole("button", { name: "View bag" }));
    expect(screen.getByTestId("bag-state")).toHaveTextContent("bag open");
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("inert");
    add.mockRestore();
  });

  it("shows a stream failure with Retry, which re-sends the prompt", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockResolvedValueOnce(
      sse(frame("text", { delta: "Back online." }), frame("done", { steps: 0, fallback: true }))
    );
    renderChat();
    fireEvent.click(launcher());
    fireEvent.click(screen.getByRole("button", { name: "Plan my weekend" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't reach the assistant");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Back online.")).toBeInTheDocument();
    expect(chatBodies().map((body) => body.intent)).toEqual(["help_me_choose", "help_me_choose"]);
  });

  it("stops a streaming turn and steps back to the empty state", async () => {
    let cancelled = false;
    fetchMock.mockImplementation(async (_url, init) => {
      init?.signal?.addEventListener("abort", () => {
        cancelled = true;
      });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(frame("text", { delta: "Thinking" })));
        },
      });
      return new Response(body);
    });
    renderChat();
    fireEvent.click(launcher());
    fireEvent.change(composer(), { target: { value: "Hello" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    await screen.findByText("Thinking");
    expect(composer()).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
    expect(cancelled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Back to suggestions" }));
    expect(screen.getByText("Hi, how can I help you?")).toBeInTheDocument();
    expect(composer()).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
    expect(screen.getByRole("article", { name: "Hello" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to suggestions" }));
    fireEvent.click(screen.getByRole("button", { name: "Track my order" }));
    expect(chatBodies()).toHaveLength(2);
  });

  it("badges the launcher for notifications while closed and clears on open", () => {
    renderChat();
    fireEvent.click(screen.getByRole("button", { name: "Simulate webhook" }));
    expect(launcher()).toHaveAccessibleName("Chat with our AI (1 message)");
    expect(screen.getByText("1 message")).toBeInTheDocument();

    fireEvent.click(launcher());
    expect(screen.queryByText("1 message")).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "On its way" })).toHaveTextContent(
      "Your order shipped."
    );
    expect(screen.queryByRole("group", { name: "Rate this answer" })).not.toBeInTheDocument();
  });

  it("restores the conversation from sessionStorage", async () => {
    window.sessionStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        activeIndex: 0,
        turns: [
          {
            id: "t1",
            source: "user",
            prompt: "Earlier question",
            items: [{ kind: "text", text: "Earlier **answer**" }],
            suggestions: [],
            status: "done",
            error: null,
            feedback: null,
            toolStatus: null,
          },
        ],
      })
    );
    renderChat();
    await act(async () => undefined);
    fireEvent.click(launcher());
    const card = screen.getByRole("article", { name: "Earlier question" });
    expect(within(card).getByText("answer").tagName).toBe("STRONG");
  });
});
