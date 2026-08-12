import { describe, expect, it, vi } from "vitest";
import { createSearchSessionStore } from "@/features/search/search-session-store";

describe("search session store", () => {
  it("does not emit when clearing an already empty session", () => {
    const store = createSearchSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.clear();

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not emit for an unchanged patch", () => {
    const store = createSearchSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.patch({ selectedIndex: 0, previewContent: null });

    expect(listener).not.toHaveBeenCalled();
  });
});
