import { describe, expect, it, vi } from "vitest";
import {
  createSearchFileReader,
  scheduleSelectedSearchPreviewWithReader,
} from "@/components/layout/search-file-reader";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { createSearchSessionStore } from "@/features/search/search-session-store";

describe("search file reader", () => {
  it("creates a reader that can allow or block backend reads", async () => {
    const openFile = vi.fn(async () => "backend");
    const readFile = createSearchFileReader({
      activePath: "/workspace/Entry.ets",
      getOpenDocumentContent: () => null,
      getActiveContent: () => "active",
      openFile,
    });

    await expect(readFile("/workspace/Other.ets")).resolves.toBe("backend");
    await expect(readFile("/workspace/Missing.ets", false)).resolves.toBeNull();
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("schedules previews without falling back to backend reads", async () => {
    vi.useFakeTimers();
    const openFile = vi.fn(async () => "backend");
    const sessionStore = createSearchSessionStore();
    sessionStore.patch({
      result: {
        query: { kind: "text", query: "width" },
        matches: [{
          path: "/workspace/Other.ets",
          relativePath: "Other.ets",
          fileName: "Other.ets",
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
      selectedIndex: 0,
    });
    const readFile = createSearchFileReader({
      activePath: "/workspace/Entry.ets",
      getOpenDocumentContent: () => null,
      getActiveContent: () => "active",
      openFile,
    });

    scheduleSelectedSearchPreviewWithReader({
      activeOverlay: "searchEverywhere",
      mode: "find",
      selectedIndex: 0,
      delayMs: 0,
      sessionStore,
      interactionRuntime: createSearchInteractionRuntime(),
      readFile,
    });
    await vi.runAllTimersAsync();

    expect(openFile).not.toHaveBeenCalled();
    expect(sessionStore.getSnapshot().previewContent).toBeNull();
    vi.useRealTimers();
  });
});
