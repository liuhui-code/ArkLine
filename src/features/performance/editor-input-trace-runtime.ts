import {
  beginInteractionTrace,
  type InteractionTraceHandle,
} from "@/features/performance/interaction-trace-store";

export type EditorInputTraceScheduler = {
  schedule(callback: () => void): number;
  cancel(handle: number): void;
};

type EditorInputTraceRuntimeOptions = {
  beginTrace?: typeof beginInteractionTrace;
  scheduler?: EditorInputTraceScheduler;
};

type PendingInput = {
  trace: InteractionTraceHandle;
  inputType: string;
  documentPhase: ReturnType<InteractionTraceHandle["startPhase"]>;
  visiblePhase: ReturnType<InteractionTraceHandle["startPhase"]>;
  documentChanged: boolean;
};

const MAX_PENDING_INPUTS = 64;

export function createEditorInputTraceRuntime({
  beginTrace = beginInteractionTrace,
  scheduler = browserFrameScheduler(),
}: EditorInputTraceRuntimeOptions = {}) {
  let pending: PendingInput[] = [];
  let firstFrame: number | null = null;
  let secondFrame: number | null = null;

  function scheduleFlush() {
    if (firstFrame != null) return;
    firstFrame = scheduler.schedule(() => {
      firstFrame = null;
      secondFrame = scheduler.schedule(() => {
        secondFrame = null;
        flush();
      });
    });
  }

  function flush() {
    const completed = pending;
    pending = [];
    for (const item of completed) {
      if (!item.documentChanged) {
        item.documentPhase.finish("cancelled", "no-document-change");
      }
      item.visiblePhase.finish("ok", `inputType=${item.inputType}`);
      item.trace.finish("ok");
    }
  }

  return {
    begin(label: string, inputType = "unknown") {
      const trace = beginTrace("editorInput", label, undefined, {
        attributes: { inputType },
      });
      pending.push({
        trace,
        inputType,
        documentPhase: trace.startPhase("documentTransaction"),
        visiblePhase: trace.startPhase("visibleCommit"),
        documentChanged: false,
      });
      while (pending.length > MAX_PENDING_INPUTS) {
        const dropped = pending.shift()!;
        dropped.documentPhase.finish("superseded", "trace-buffer-pressure");
        dropped.visiblePhase.finish("superseded", "trace-buffer-pressure");
        dropped.trace.finish("superseded");
      }
      scheduleFlush();
      return trace.id;
    },
    documentChanged() {
      const item = [...pending].reverse().find((candidate) => !candidate.documentChanged);
      if (!item) return;
      item.documentChanged = true;
      item.documentPhase.finish("ok", `inputType=${item.inputType}`);
    },
    cancel() {
      if (firstFrame != null) scheduler.cancel(firstFrame);
      if (secondFrame != null) scheduler.cancel(secondFrame);
      firstFrame = null;
      secondFrame = null;
      const cancelled = pending;
      pending = [];
      for (const item of cancelled) {
        item.documentPhase.finish("cancelled", "editor-disposed");
        item.visiblePhase.finish("cancelled", "editor-disposed");
        item.trace.finish("cancelled");
      }
    },
    pendingCount: () => pending.length,
  };
}

function browserFrameScheduler(): EditorInputTraceScheduler {
  return {
    schedule(callback) {
      if (typeof window !== "undefined" && window.requestAnimationFrame) {
        return window.requestAnimationFrame(callback);
      }
      return globalThis.setTimeout(callback, 16) as unknown as number;
    },
    cancel(handle) {
      if (typeof window !== "undefined" && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(handle);
      } else {
        globalThis.clearTimeout(handle);
      }
    },
  };
}
