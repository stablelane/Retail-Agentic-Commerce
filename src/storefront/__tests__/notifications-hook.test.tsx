import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { BagProvider } from "@/components/store/BagProvider";
import type { NotificationBlock } from "@/lib/agent/types";
import {
  NOTIFICATIONS_STORAGE_KEY,
  NOTIFICATIONS_STREAM_URL,
  parseNotification,
} from "@/lib/notifications/useNotifications";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/commerce/session-sync", () => ({
  getSessionSyncer: () => ({ start: () => () => undefined }),
}));

type Listener = (event: Event) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2;
    this.closed = true;
  }

  dispatch(type: string, init: MessageEventInit = {}): void {
    const event = new MessageEvent(type, init);
    act(() => this.listeners.get(type)?.forEach((listener) => listener(event)));
  }

  notify(id: string, block: Partial<NotificationBlock> = {}): void {
    this.dispatch("notification", { lastEventId: id, data: JSON.stringify(notification(block)) });
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!source) throw new Error("no EventSource");
    return source;
  }
}

function notification(overrides: Partial<NotificationBlock> = {}): NotificationBlock {
  return {
    type: "notification",
    subject: "On its way",
    message: "Your order shipped.",
    status: "order_shipped",
    orderId: "order_1",
    trackingUrl: null,
    receivedAt: "2026-10-07T12:00:00.000Z",
    ...overrides,
  };
}

function renderChat() {
  return render(
    <ChatProvider>
      <BagProvider>
        <ChatLauncher />
        <ChatOverlay />
      </BagProvider>
    </ChatProvider>
  );
}

function launcher() {
  return screen.getByRole("button", { name: /^Chat with our AI/ });
}

beforeEach(() => {
  window.sessionStorage.clear();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("notifications in the chat", () => {
  it("badges the launcher with the unread count, dedupes by id and clears on open", () => {
    renderChat();
    const source = FakeEventSource.latest();
    expect(source.url).toBe(NOTIFICATIONS_STREAM_URL);
    expect(screen.queryByText(/^\d+ messages?$/)).not.toBeInTheDocument();

    source.notify("boot1-1");
    expect(screen.getByText("1 message")).toBeInTheDocument();
    expect(launcher()).toHaveAccessibleName("Chat with our AI (1 message)");

    source.notify("boot1-2", { subject: "Out for delivery", status: "out_for_delivery" });
    source.notify("boot1-1");
    expect(screen.getByText("2 messages")).toBeInTheDocument();

    fireEvent.click(launcher());
    expect(screen.queryByText("2 messages")).not.toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Out for delivery" });
    expect(card).toHaveTextContent("Your order shipped.");
    expect(within(card).getByRole("link", { name: "View order" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/orders\/order_1\?email=/)
    );
  });

  it("pushes a card without badging while the overlay is open", () => {
    renderChat();
    fireEvent.click(launcher());
    FakeEventSource.latest().notify("boot1-1", { subject: "Delivered", status: "delivered" });
    expect(screen.getByRole("article", { name: "Delivered" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(/^\d+ messages?$/)).not.toBeInTheDocument();
  });

  it("ignores malformed frames", () => {
    renderChat();
    const source = FakeEventSource.latest();
    source.dispatch("notification", { lastEventId: "boot1-1", data: "{not json" });
    source.dispatch("notification", {
      lastEventId: "boot1-2",
      data: JSON.stringify({ ...notification(), status: 3 }),
    });
    source.dispatch("notification", { data: JSON.stringify(notification()) });
    expect(screen.queryByText(/^\d+ messages?$/)).not.toBeInTheDocument();
  });

  it("persists the cursor and resumes from it after the stream closes", () => {
    vi.useFakeTimers();
    const view = renderChat();
    const first = FakeEventSource.latest();
    first.dispatch("ready", { lastEventId: "boot1-4" });
    expect(JSON.parse(window.sessionStorage.getItem(NOTIFICATIONS_STORAGE_KEY) ?? "{}")).toEqual({
      cursor: "boot1-4",
      seen: [],
    });
    first.notify("boot1-5");

    // Transient errors are left to the browser's own retry.
    first.readyState = 0;
    first.dispatch("error");
    expect(FakeEventSource.instances).toHaveLength(1);

    first.readyState = 2;
    first.dispatch("error");
    expect(first.closed).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    const second = FakeEventSource.latest();
    expect(second).not.toBe(first);
    expect(second.url).toBe(`${NOTIFICATIONS_STREAM_URL}?lastEventId=boot1-5`);

    second.notify("boot1-5");
    expect(screen.getByText("1 message")).toBeInTheDocument();

    view.unmount();
    expect(second.closed).toBe(true);
  });

  it("dedupes against ids seen before a reload", () => {
    window.sessionStorage.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify({ cursor: "boot1-7", seen: ["boot1-7"] })
    );
    renderChat();
    const source = FakeEventSource.latest();
    expect(source.url).toBe(`${NOTIFICATIONS_STREAM_URL}?lastEventId=boot1-7`);
    source.notify("boot1-7");
    expect(screen.queryByText(/^\d+ messages?$/)).not.toBeInTheDocument();
    source.notify("boot1-8");
    expect(screen.getByText("1 message")).toBeInTheDocument();
  });
});

describe("parseNotification", () => {
  it("keeps only the notification block fields", () => {
    expect(parseNotification(JSON.stringify({ ...notification(), extra: "<b>" }))).toEqual(
      notification()
    );
    expect(parseNotification(JSON.stringify({ ...notification(), type: "order_status" }))).toBe(
      null
    );
    expect(parseNotification(JSON.stringify({ ...notification(), trackingUrl: 5 }))).toBeNull();
    expect(parseNotification(undefined)).toBeNull();
  });
});
