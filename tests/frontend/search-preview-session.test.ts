import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleSelectedSearchPreview } from "@/features/search/search-preview-session";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { createSearchSessionStore } from "@/features/search/search-session-store";

describe("search preview session", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears preview without reading files outside text search overlays", async () => {
    vi.useFakeTimers();
    const readFile = vi.fn(async () => "content");
    const sessionStore = createSearchSessionStore();
    sessionStore.patch({ previewContent: "stale", result: resultWithMatch("/workspace/A.ets") });

    scheduleSelectedSearchPreview({
      activeOverlay: "none",
      mode: "find",
      selectedIndex: 0,
      delayMs: 200,
      sessionStore,
      interactionRuntime: createSearchInteractionRuntime(),
      readFile,
    });

    await vi.runAllTimersAsync();
    expect(readFile).not.toHaveBeenCalled();
    expect(sessionStore.getSnapshot().previewContent).toBeNull();
  });

  it("loads the selected text-search preview after the debounce", async () => {
    vi.useFakeTimers();
    const readFile = vi.fn(async () => "preview content");
    const sessionStore = createSearchSessionStore();
    sessionStore.patch({ result: resultWithMatch("/workspace/A.ets") });

    scheduleSelectedSearchPreview({
      activeOverlay: "searchEverywhere",
      mode: "find",
      selectedIndex: 0,
      delayMs: 200,
      sessionStore,
      interactionRuntime: createSearchInteractionRuntime(),
      readFile,
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(readFile).toHaveBeenCalledWith("/workspace/A.ets");
    expect(sessionStore.getSnapshot().previewContent).toBe("preview content");
  });
});

function resultWithMatch(path: string) {
  return {
    query: { kind: "text" as const, query: "width" },
    matches: [{
      path,
      relativePath: "A.ets",
      fileName: "A.ets",
      line: 1,
      column: 1,
      summary: "width",
      preview: "width",
      previewStart: 0,
      previewEnd: 5,
      contextBefore: [],
      contextAfter: [],
    }],
  };
}
