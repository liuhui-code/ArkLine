import { describe, expect, it } from "vitest";
import {
  isLargeEditorDocument,
  LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD,
} from "@/editor/editor-document-budget";

describe("editor document budget", () => {
  it("keeps small documents in normal editor mode", () => {
    expect(isLargeEditorDocument("x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD - 1))).toBe(false);
  });

  it("uses large document mode at the character threshold", () => {
    expect(isLargeEditorDocument("x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD))).toBe(true);
  });
});
