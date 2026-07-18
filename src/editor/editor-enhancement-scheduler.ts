export type EditorEnhancementSchedulerHost = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
};

export function scheduleEditorEnhancement(
  callback: () => void,
  host: EditorEnhancementSchedulerHost = browserSchedulerHost(),
) {
  if (host.requestIdleCallback && host.cancelIdleCallback) {
    const handle = host.requestIdleCallback(callback, { timeout: 180 });
    return () => host.cancelIdleCallback?.(handle);
  }

  const handle = host.setTimeout(callback, 32);
  return () => host.clearTimeout(handle);
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
