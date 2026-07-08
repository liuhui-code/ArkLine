import { Text } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { createEditorChangeDispatcher } from "@/editor/editor-change-dispatcher";

describe("editor change dispatcher", () => {
  it("coalesces queued documents and emits only the latest value", () => {
    const callbacks: (() => void)[] = [];
    const onChange = vi.fn();
    const dispatcher = createEditorChangeDispatcher(onChange, {
      schedule: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancel: vi.fn(),
    });

    dispatcher.queue(Text.of(["first"]));
    dispatcher.queue(Text.of(["second"]));

    expect(onChange).not.toHaveBeenCalled();
    callbacks[0]?.();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("second");
  });

  it("supports explicit flush", () => {
    const onChange = vi.fn();
    const dispatcher = createEditorChangeDispatcher(onChange, {
      schedule: vi.fn(() => 1),
      cancel: vi.fn(),
    });

    dispatcher.queue(Text.of(["value"]));
    dispatcher.flush();

    expect(onChange).toHaveBeenCalledWith("value");
  });

  it("cancels pending work without emitting a value", () => {
    const cancel = vi.fn();
    const onChange = vi.fn();
    const dispatcher = createEditorChangeDispatcher(onChange, {
      schedule: vi.fn(() => 7),
      cancel,
    });

    dispatcher.queue(Text.of(["value"]));
    dispatcher.cancel();
    dispatcher.flush();

    expect(cancel).toHaveBeenCalledWith(7);
    expect(onChange).not.toHaveBeenCalled();
  });
});
