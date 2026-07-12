import { describe, expect, it, vi } from "vitest";
import {
  moveSearchSelection,
  setSearchSelection,
} from "@/components/layout/search-selection-actions";
import { createSearchSessionStore } from "@/features/search/search-session-store";

describe("search selection actions", () => {
  it("selects the next loaded result and schedules preview", () => {
    const store = createSearchSessionStore();
    const scheduleSelectedPreview = vi.fn();
    const loadNextPage = vi.fn();
    store.patch({
      result: {
        query: { kind: "text", query: "width" },
        matches: [match("A.ets"), match("B.ets")],
      },
      selectedIndex: 0,
    });

    moveSearchSelection({
      mode: "find",
      direction: 1,
      sessionStore: store,
      scheduleSelectedPreview,
      loadNextPage,
    });

    expect(store.getSnapshot().selectedIndex).toBe(1);
    expect(scheduleSelectedPreview).toHaveBeenCalledWith(1);
    expect(loadNextPage).not.toHaveBeenCalled();
  });

  it("loads the next page when moving past the loaded boundary", () => {
    const store = createSearchSessionStore();
    const scheduleSelectedPreview = vi.fn();
    const loadNextPage = vi.fn();
    store.patch({
      candidates: [candidate("Entry"), candidate("Other")],
      selectedIndex: 1,
      entityNextCursor: 2,
    });

    moveSearchSelection({
      mode: "searchEverywhere",
      direction: 1,
      sessionStore: store,
      scheduleSelectedPreview,
      loadNextPage,
    });

    expect(loadNextPage).toHaveBeenCalledWith(2);
    expect(scheduleSelectedPreview).not.toHaveBeenCalled();
  });

  it("sets selection directly and schedules preview", () => {
    const store = createSearchSessionStore();
    const scheduleSelectedPreview = vi.fn();

    setSearchSelection({
      selectedIndex: 3,
      sessionStore: store,
      scheduleSelectedPreview,
    });

    expect(store.getSnapshot().selectedIndex).toBe(3);
    expect(scheduleSelectedPreview).toHaveBeenCalledWith(3);
  });
});

function candidate(title: string) {
  return {
    id: `file:${title}`,
    source: "file" as const,
    kind: "file" as const,
    title,
    subtitle: title,
    path: `/workspace/${title}.ets`,
    line: 1,
    column: 1,
    score: 1,
    freshness: "ready" as const,
  };
}

function match(fileName: string) {
  return {
    path: `/workspace/${fileName}`,
    relativePath: fileName,
    fileName,
    line: 1,
    column: 1,
    summary: "width",
    preview: "width",
    previewStart: 0,
    previewEnd: 5,
    contextBefore: [],
    contextAfter: [],
  };
}
