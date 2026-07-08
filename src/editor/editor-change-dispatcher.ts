import type { Text } from "@codemirror/state";

type ScheduleFrame = (callback: () => void) => number;
type CancelFrame = (handle: number) => void;

export type EditorChangeScheduler = {
  schedule: ScheduleFrame;
  cancel: CancelFrame;
};

export function createBrowserEditorChangeScheduler(): EditorChangeScheduler {
  return {
    schedule: (callback) => {
      if (typeof window !== "undefined" && window.requestAnimationFrame) {
        return window.requestAnimationFrame(callback);
      }
      return globalThis.setTimeout(callback, 16) as unknown as number;
    },
    cancel: (handle) => {
      if (typeof window !== "undefined" && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(handle);
        return;
      }
      globalThis.clearTimeout(handle);
    },
  };
}

export function createEditorChangeDispatcher(
  onChange: (value: string) => void,
  scheduler = createBrowserEditorChangeScheduler(),
) {
  let pendingDocument: Text | null = null;
  let frameHandle: number | null = null;

  function flush() {
    const document = pendingDocument;
    pendingDocument = null;
    frameHandle = null;
    if (document) onChange(document.toString());
  }

  return {
    queue(document: Text) {
      pendingDocument = document;
      if (frameHandle == null) frameHandle = scheduler.schedule(flush);
    },
    flush,
    cancel() {
      if (frameHandle != null) scheduler.cancel(frameHandle);
      frameHandle = null;
      pendingDocument = null;
    },
  };
}
