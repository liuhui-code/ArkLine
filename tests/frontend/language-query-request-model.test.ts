import { describe, expect, it, vi } from "vitest";
import {
  buildLanguageQueryRequest,
  buildLanguageQuerySnapshot,
  classifyLanguageQueryContent,
  LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD,
  LANGUAGE_QUERY_CONTENT_BUDGET,
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
      contentClass: "large",
      contentBudgetExceeded: true,
    });
    expect(getActiveContent).toHaveBeenCalledTimes(1);
  });

  it("uses a budgeted content slice when active content length is known", () => {
    const getActiveContent = vi.fn(() => "full content should not be requested");
    const getActiveContentLength = vi.fn(() => LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD);
    const getActiveContentSlice = vi.fn((start: number, end: number) => `slice:${start}:${end}`);

    const snapshot = buildLanguageQuerySnapshot({
      activePath: "/workspace/Huge.ets",
      editorSelection: { line: 9, column: 4 },
      getActiveContent,
      getActiveContentLength,
      getActiveContentSlice,
    });

    expect(snapshot.request).toEqual({
      path: "/workspace/Huge.ets",
      line: 9,
      column: 4,
      content: `slice:0:${LANGUAGE_QUERY_CONTENT_BUDGET}`,
    });
    expect(snapshot.meta).toEqual({
      contentLength: LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD,
      largeDocument: true,
      contentClass: "oversized",
      contentBudgetExceeded: true,
    });
    expect(getActiveContent).not.toHaveBeenCalled();
    expect(getActiveContentLength).toHaveBeenCalledTimes(1);
    expect(getActiveContentSlice).toHaveBeenCalledWith(0, LANGUAGE_QUERY_CONTENT_BUDGET);
  });

  it("classifies normal large and oversized language query content", () => {
    expect(classifyLanguageQueryContent("x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD - 1))).toBe("normal");
    expect(classifyLanguageQueryContent("x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD))).toBe("large");
    expect(classifyLanguageQueryContent("x".repeat(LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD))).toBe("oversized");
  });
});
