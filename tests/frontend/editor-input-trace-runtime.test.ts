import { describe, expect, it, vi } from "vitest";
import {
  createEditorInputTraceRuntime,
  type EditorInputTraceScheduler,
} from "@/features/performance/editor-input-trace-runtime";

describe("editor input trace runtime", () => {
  it("coalesces rapid input into one stable-frame flush without dropping evidence", () => {
    const callbacks: Array<() => void> = [];
    const traces = [traceHandle("first"), traceHandle("second")];
    const runtime = createEditorInputTraceRuntime({
      beginTrace: vi.fn(() => traces.shift()!.handle),
      scheduler: scheduler(callbacks),
    });

    runtime.begin("Main.ets", "insertText");
    runtime.documentChanged();
    runtime.begin("Main.ets", "deleteContentBackward");
    runtime.documentChanged();

    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.();
    callbacks.shift()?.();

    for (const trace of [runtimeTrace("first"), runtimeTrace("second")]) {
      expect(trace.finish).toHaveBeenCalledWith("ok");
      expect(trace.phase.finish).toHaveBeenCalledWith("ok", expect.any(String));
    }
  });

  it("cancels pending evidence when the editor is destroyed", () => {
    const callbacks: Array<() => void> = [];
    const trace = traceHandle("pending");
    const runtime = createEditorInputTraceRuntime({
      beginTrace: () => trace.handle,
      scheduler: scheduler(callbacks),
    });

    runtime.begin("Main.ets", "insertText");
    runtime.cancel();

    expect(trace.finish).toHaveBeenCalledWith("cancelled");
  });
});

const recorded = new Map<string, ReturnType<typeof traceHandle>>();

function traceHandle(id: string) {
  const phase = { finish: vi.fn() };
  const finish = vi.fn();
  const value = {
    handle: { id, startPhase: vi.fn(() => phase), finish },
    phase,
    finish,
  };
  recorded.set(id, value);
  return value;
}

function runtimeTrace(id: string) {
  return recorded.get(id)!;
}

function scheduler(callbacks: Array<() => void>): EditorInputTraceScheduler {
  let nextId = 0;
  return {
    schedule(callback) {
      callbacks.push(callback);
      return ++nextId;
    },
    cancel: vi.fn(),
  };
}
