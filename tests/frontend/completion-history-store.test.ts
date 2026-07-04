import { createCompletionHistoryStore } from "@/components/layout/completion-history-store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("completion history store", () => {
  it("persists accepted labels in old-to-new order", () => {
    const storage = new MemoryStorage();
    const first = createCompletionHistoryStore({
      storage,
      now: (() => {
        let tick = 10;
        return () => {
          tick += 1;
          return tick;
        };
      })(),
    });

    first.recordAccepted("build()");
    first.recordAccepted("browse()");
    first.recordAccepted("build()");

    const second = createCompletionHistoryStore({ storage });

    expect(second.acceptedLabels()).toEqual(["browse()", "build()"]);
  });
});
