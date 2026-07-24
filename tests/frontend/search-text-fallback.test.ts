import { describe, expect, it, vi } from "vitest";
import {
  readSearchFileForSearch,
  runFallbackTextSearch,
} from "@/components/layout/search-text-fallback";

const plainOptions = { caseSensitive: false, wholeWord: false };

describe("search text fallback", () => {
  it("reads active editor content before open documents or backend files", async () => {
    const openFile = vi.fn(async () => "backend");

    const content = await readSearchFileForSearch({
      path: "/workspace/Entry.ets",
      activePath: "/workspace/Entry.ets",
      getOpenDocumentContent: () => "open doc",
      getActiveContent: () => "active content",
      openFile,
    });

    expect(content).toBe("open doc");
    expect(openFile).not.toHaveBeenCalled();
  });

  it("uses active content when the active open document is not cached", async () => {
    const content = await readSearchFileForSearch({
      path: "/workspace/Entry.ets",
      activePath: "/workspace/Entry.ets",
      getOpenDocumentContent: () => null,
      getActiveContent: () => "active content",
      openFile: vi.fn(async () => "backend"),
    });

    expect(content).toBe("active content");
  });

  it("uses open document content and can skip backend reads", async () => {
    const openFile = vi.fn(async () => "backend");

    expect(await readSearchFileForSearch({
      path: "/workspace/Other.ets",
      activePath: "/workspace/Entry.ets",
      getOpenDocumentContent: () => "open doc",
      getActiveContent: () => "active",
      openFile,
      allowBackendRead: false,
    })).toBe("open doc");
    expect(await readSearchFileForSearch({
      path: "/workspace/Missing.ets",
      activePath: "/workspace/Entry.ets",
      getOpenDocumentContent: () => null,
      getActiveContent: () => "active",
      openFile,
      allowBackendRead: false,
    })).toBeNull();
    expect(openFile).not.toHaveBeenCalled();
  });

  it("uses native text search when available and documents are clean", async () => {
    const searchNative = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
    }));

    await runFallbackTextSearch({
      query: "width",
      dirty: false,
      generation: 12,
      cursor: null,
      rootPath: "/workspace",
      options: plainOptions,
      paths: ["/workspace/Entry.ets"],
      dirtyPaths: [],
      canUseNativeTextSearch: true,
      searchNative,
      readFile: vi.fn(async () => "width"),
    });

    expect(searchNative).toHaveBeenCalledWith(expect.objectContaining({
      query: "width",
      generation: 12,
      rootPath: "/workspace",
      cursor: null,
    }));
  });

  it("uses frontend text search when native search is unavailable", async () => {
    const result = await runFallbackTextSearch({
      query: "width",
      dirty: true,
      generation: 12,
      cursor: null,
      rootPath: "/workspace",
      options: plainOptions,
      paths: ["/workspace/Entry.ets", "/workspace/Broken.ets"],
      dirtyPaths: ["/workspace/Entry.ets"],
      canUseNativeTextSearch: false,
      readFile: async (path) => {
        if (path.endsWith("Broken.ets")) throw new Error("unreadable");
        return "const width = 1;";
      },
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.relativePath).toBe("Entry.ets");
  });
});
