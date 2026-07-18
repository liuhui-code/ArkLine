import { vi } from "vitest";
import { scheduleEditorEnhancement } from "@/editor/editor-enhancement-scheduler";

describe("editor enhancement scheduler", () => {
  it("prefers an idle task and supports cancellation", () => {
    const requestIdleCallback = vi.fn(() => 7);
    const cancelIdleCallback = vi.fn();
    const callback = vi.fn();
    const cancel = scheduleEditorEnhancement(callback, {
      requestIdleCallback,
      cancelIdleCallback,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
    });

    expect(requestIdleCallback).toHaveBeenCalledWith(callback, { timeout: 180 });
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("falls back to a short cancellable timer", () => {
    const callback = vi.fn();
    const clearTimeout = vi.fn();
    const cancel = scheduleEditorEnhancement(callback, {
      setTimeout: vi.fn(() => 9),
      clearTimeout,
    });

    cancel();
    expect(clearTimeout).toHaveBeenCalledWith(9);
  });
});
