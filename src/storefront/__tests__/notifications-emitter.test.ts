// @vitest-environment node
import type { NotificationBlock } from "@/lib/agent/types";
import { createNotificationEmitter, getNotificationEmitter } from "@/lib/notifications/emitter";

vi.mock("server-only", () => ({}));

function block(orderId: string): NotificationBlock {
  return {
    type: "notification",
    subject: "Update",
    message: `Order ${orderId} shipped.`,
    status: "order_shipped",
    orderId,
    trackingUrl: null,
    receivedAt: "2026-10-07T12:00:00.000Z",
  };
}

describe("notification emitter", () => {
  it("delivers to subscribers until they unsubscribe", () => {
    const emitter = createNotificationEmitter({ bootId: "boot1" });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = emitter.subscribe(first);
    emitter.subscribe(second);
    expect(emitter.subscriberCount()).toBe(2);

    const event = emitter.publish(block("order_1"));
    expect(event).toEqual({ id: "boot1-1", block: block("order_1") });
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);

    unsubscribeFirst?.();
    unsubscribeFirst?.();
    expect(emitter.subscriberCount()).toBe(1);
    emitter.publish(block("order_2"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("keeps delivering when one subscriber throws", () => {
    const emitter = createNotificationEmitter({ bootId: "boot1" });
    const healthy = vi.fn();
    emitter.subscribe(() => {
      throw new Error("closed");
    });
    emitter.subscribe(healthy);
    emitter.publish(block("order_1"));
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("caps subscribers", () => {
    const emitter = createNotificationEmitter({ maxSubscribers: 2 });
    const unsubscribe = emitter.subscribe(vi.fn());
    expect(emitter.subscribe(vi.fn())).not.toBeNull();
    expect(emitter.subscribe(vi.fn())).toBeNull();
    unsubscribe?.();
    expect(emitter.subscribe(vi.fn())).not.toBeNull();
  });

  it("keeps a bounded buffer and replays events after a cursor", () => {
    const emitter = createNotificationEmitter({ bootId: "boot1", bufferSize: 3 });
    expect(emitter.cursor()).toBe("boot1-0");
    for (let index = 1; index <= 5; index += 1) emitter.publish(block(`order_${index}`));
    expect(emitter.cursor()).toBe("boot1-5");

    const ids = (cursor: string | null) => emitter.since(cursor).map((event) => event.id);
    expect(ids("boot1-0")).toEqual(["boot1-3", "boot1-4", "boot1-5"]);
    expect(ids("boot1-3")).toEqual(["boot1-4", "boot1-5"]);
    expect(ids("boot1-5")).toEqual([]);
    // A cursor from a previous process: everything since this boot is new to the client.
    expect(ids("old0-42")).toEqual(["boot1-3", "boot1-4", "boot1-5"]);
    expect(ids(null)).toEqual([]);
    expect(ids("not a cursor")).toEqual([]);
  });

  it("shares one instance per process", () => {
    expect(getNotificationEmitter()).toBe(getNotificationEmitter());
  });
});
