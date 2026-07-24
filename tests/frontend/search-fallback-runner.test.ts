import { describe, expect, it, vi } from "vitest";
import { runSearchFallbackText } from "@/components/layout/search-fallback-runner";

describe("search fallback runner", () => {
  it("passes workspace state to native text search when clean", async () => {
    const searchNative = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
    }));

    await runSearchFallbackText({
      query: "width",
      dirty: false,
      generation: 7,
      cursor: null,
      rootPath: "/workspace",
      options: { caseSensitive: false, wholeWord: false },
      paths: ["/workspace/Entry.ets"],
      dirtyPaths: [],
      canUseNativeTextSearch: true,
      searchNative,
      readFile: vi.fn(async () => "width"),
    });

    expect(searchNative).toHaveBeenCalledWith(expect.objectContaining({
      query: "width",
      generation: 7,
      rootPath: "/workspace",
      cursor: null,
    }));
  });

  it("overlays only dirty documents on the native index result", async () => {
    const readFile = vi.fn(async () => "const width = 1;");
    const searchNative = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [{
        path: "/workspace/Entry.ets",
        relativePath: "Entry.ets",
        fileName: "Entry.ets",
        line: 1,
        column: 1,
        summary: "const width = 0;",
        preview: "const width = 0;",
        previewStart: 6,
        previewEnd: 11,
        contextBefore: [],
        contextAfter: [],
      }],
    }));
    const result = await runSearchFallbackText({
      query: "width",
      dirty: true,
      generation: 8,
      cursor: null,
      rootPath: "/workspace",
      options: { caseSensitive: false, wholeWord: false },
      paths: ["/workspace/Entry.ets", "/workspace/Other.ets"],
      dirtyPaths: ["/workspace/Entry.ets"],
      canUseNativeTextSearch: true,
      searchNative,
      readFile,
    });

    expect(searchNative).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith("/workspace/Entry.ets");
    expect(readFile).not.toHaveBeenCalledWith("/workspace/Other.ets");
    expect(result.matches[0]?.summary).toBe("const width = 1;");
  });
});
