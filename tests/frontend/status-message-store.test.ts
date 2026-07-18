import { describe, expect, it, vi } from "vitest";
import { createStatusMessageStore } from "@/features/status/status-message-store";

describe("status message store", () => {
  it("publishes changed messages and ignores duplicate writes", () => {
    const store = createStatusMessageStore("Ready");
    const listener = vi.fn();
    store.subscribe(listener);

    store.setMessage("Opening Entry.ets...");
    store.setMessage("Opening Entry.ets...");

    expect(store.getSnapshot()).toBe("Opening Entry.ets...");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops publishing after unsubscribe", () => {
    const store = createStatusMessageStore("Ready");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setMessage("Build succeeded");

    expect(listener).not.toHaveBeenCalled();
  });
});
