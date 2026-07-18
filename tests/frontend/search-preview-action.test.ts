import { describe, expect, it, vi } from "vitest";
import { createSearchPreviewAction } from "@/components/layout/search-preview-action";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { createSearchSessionStore } from "@/features/search/search-session-store";

describe("search preview action", () => {
  it("schedules text result previews through the shared reader", async () => {
    vi.useFakeTimers();
    const readFile = vi.fn(async () => "preview content");
    const store = createSearchSessionStore();
    store.patch({
      result: {
        query: { kind: "text", query: "width" },
        matches: [{
          path: "/workspace/Entry.ets",
          relativePath: "Entry.ets",
          fileName: "Entry.ets",
          line: 1,
          column: 1,
          summary: "width",
          preview: "width",
          previewStart: 0,
          previewEnd: 5,
          contextBefore: [],
          contextAfter: [],
        }],
      },
    });
    const schedulePreview = createSearchPreviewAction({
      getActiveOverlay: () => "searchEverywhere",
      getMode: () => "find",
      delayMs: 0,
      sessionStore: store,
      interactionRuntime: createSearchInteractionRuntime(),
      readFile,
    });

    schedulePreview(0);
    await vi.runAllTimersAsync();

    expect(readFile).toHaveBeenCalledWith("/workspace/Entry.ets", true);
    expect(store.getSnapshot().previewContent).toBe("preview content");
    vi.useRealTimers();
  });

  it("clears preview for Search Everywhere entity mode", () => {
    const store = createSearchSessionStore();
    store.patch({ previewContent: "old preview" });
    const schedulePreview = createSearchPreviewAction({
      getActiveOverlay: () => "searchEverywhere",
      getMode: () => "searchEverywhere",
      delayMs: 0,
      sessionStore: store,
      interactionRuntime: createSearchInteractionRuntime(),
      readFile: vi.fn(),
    });

    schedulePreview(0);

    expect(store.getSnapshot().previewContent).toBeNull();
  });
});
