export type StatusMessageStore = ReturnType<typeof createStatusMessageStore>;

export function createStatusMessageStore(initialMessage: string) {
  let message = initialMessage;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => message,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMessage(nextMessage: string) {
      if (nextMessage === message) return;
      message = nextMessage;
      listeners.forEach((listener) => listener());
    },
  };
}
