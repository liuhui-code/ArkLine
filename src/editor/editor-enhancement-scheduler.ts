export type EditorEnhancementSchedulerHost = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
};

export function scheduleEditorEnhancement(
  callback: () => void,
  host: EditorEnhancementSchedulerHost = browserSchedulerHost(),
  delayMs = 0,
) {
  let idleHandle: number | null = null;
  let timerHandle: number | null = null;
  let cancelled = false;
  const scheduleIdle = () => {
    timerHandle = null;
    if (cancelled) return;
    if (host.requestIdleCallback && host.cancelIdleCallback) {
      idleHandle = host.requestIdleCallback(callback);
      return;
    }
    timerHandle = host.setTimeout(callback, 32);
  };

  if (delayMs > 0) {
    timerHandle = host.setTimeout(scheduleIdle, delayMs);
  } else {
    scheduleIdle();
  }

  return () => {
    cancelled = true;
    if (idleHandle != null) host.cancelIdleCallback?.(idleHandle);
    if (timerHandle != null) host.clearTimeout(timerHandle);
  };
}

function browserSchedulerHost(): EditorEnhancementSchedulerHost {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  return {
    requestIdleCallback: idleWindow.requestIdleCallback?.bind(window),
    cancelIdleCallback: idleWindow.cancelIdleCallback?.bind(window),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
}
