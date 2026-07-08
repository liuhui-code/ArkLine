export type NavigationTransaction = {
  id: number;
  path: string;
  startedAt: number;
};

export type NavigationTransactionRuntime = ReturnType<typeof createNavigationTransactionRuntime>;

export function createNavigationTransactionRuntime(now: () => number = Date.now) {
  let nextId = 0;
  let current: NavigationTransaction | null = null;

  return {
    start(path: string) {
      nextId += 1;
      current = { id: nextId, path, startedAt: now() };
      return current;
    },
    isCurrent(id: number) {
      return current?.id === id;
    },
    finish(id: number) {
      if (current?.id === id) current = null;
    },
    getCurrent() {
      return current;
    },
  };
}
