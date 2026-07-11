import { describe, expect, it, vi } from "vitest";
import {
  buildLanguageQueryRequest,
  buildLanguageQuerySnapshot,
} from "@/components/layout/language-query-request-model";
import { LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD } from "@/editor/editor-document-budget";

describe("language query request model", () => {
  it("builds a stable language query request from the active document snapshot", () => {
    const getActiveContent = vi.fn(() => "class Entry {}");

    expect(buildLanguageQueryRequest({
      activePath: "/workspace/Entry.ets",
      editorSelection: { line: 7, column: 5 },
      getActiveContent,
    })).toEqual({
      path: "/workspace/Entry.ets",
      line: 7,
      column: 5,
      content: "class Entry {}",
    });
    expect(getActiveContent).toHaveBeenCalledTimes(1);
  });

  it("reports snapshot metadata without changing the request payload", () => {
    const content = "x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD);
    const getActiveContent = vi.fn(() => content);

    const snapshot = buildLanguageQuerySnapshot({
      activePath: "/workspace/Large.ets",
      editorSelection: { line: 1, column: 1 },
      getActiveContent,
    });

    expect(snapshot.request.content).toBe(content);
    expect(snapshot.meta).toEqual({
      contentLength: LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD,
      largeDocument: true,
    });
    expect(getActiveContent).toHaveBeenCalledTimes(1);
  });
});
