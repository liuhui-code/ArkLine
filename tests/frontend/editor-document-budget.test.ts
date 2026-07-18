import { describe, expect, it } from "vitest";
import {
  EDITOR_REDUCED_RENDER_CHARACTER_THRESHOLD,
  EDITOR_REDUCED_RENDER_LINE_THRESHOLD,
  EDITOR_REDUCED_RENDER_MAX_LINE_LENGTH,
  isLargeEditorDocument,
  isEditorReducedPerformanceDocument,
  LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD,
} from "@/editor/editor-document-budget";

describe("editor document budget", () => {
  it("keeps small documents in normal editor mode", () => {
    expect(isLargeEditorDocument("x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD - 1))).toBe(false);
  });

  it("uses large document mode at the character threshold", () => {
    expect(isLargeEditorDocument("x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD))).toBe(true);
  });

  it("uses reduced rendering before language-query content is considered large", () => {
    expect(isEditorReducedPerformanceDocument(wrappedContent(EDITOR_REDUCED_RENDER_CHARACTER_THRESHOLD - 1))).toBe(false);
    expect(isEditorReducedPerformanceDocument(wrappedContent(EDITOR_REDUCED_RENDER_CHARACTER_THRESHOLD))).toBe(true);
    expect(EDITOR_REDUCED_RENDER_CHARACTER_THRESHOLD).toBeLessThan(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD);
  });

  it("uses reduced rendering for line-dense documents", () => {
    const content = "x\n".repeat(EDITOR_REDUCED_RENDER_LINE_THRESHOLD - 1);
    expect(isEditorReducedPerformanceDocument(content)).toBe(true);
  });

  it("uses reduced rendering for an excessively long visual line", () => {
    expect(isEditorReducedPerformanceDocument("x".repeat(EDITOR_REDUCED_RENDER_MAX_LINE_LENGTH - 1))).toBe(false);
    expect(isEditorReducedPerformanceDocument("x".repeat(EDITOR_REDUCED_RENDER_MAX_LINE_LENGTH))).toBe(true);
  });
});

function wrappedContent(length: number) {
  const shortLine = `${"x".repeat(1_000)}\n`;
  return shortLine.repeat(Math.ceil(length / shortLine.length)).slice(0, length);
}
