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

  it("uses the provided reader when dirty content requires frontend search", async () => {
    const readFile = vi.fn(async () => "const width = 1;");
    const result = await runSearchFallbackText({
      query: "width",
      dirty: true,
      generation: 8,
      cursor: null,
      rootPath: "/workspace",
      options: { caseSensitive: false, wholeWord: false },
      paths: ["/workspace/Entry.ets"],
      canUseNativeTextSearch: true,
      searchNative: vi.fn(async () => {
        throw new Error("native should not run");
      }),
      readFile,
    });

    expect(readFile).toHaveBeenCalledWith("/workspace/Entry.ets");
    expect(result.matches[0]?.summary).toBe("const width = 1;");
  });
});
