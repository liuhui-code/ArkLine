import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  MAX_EDITOR_SELECTED_TEXT_LENGTH,
  readSelectedTextWithinBudget,
} from "@/editor/editor-selection-budget";

describe("editor selection budget", () => {
  it("reads selected text within the payload budget", () => {
    const doc = Text.of(["hello world"]);

    expect(readSelectedTextWithinBudget(doc, 0, 5)).toBe("hello");
  });

  it("omits empty and oversized selected text", () => {
    const doc = Text.of(["x".repeat(MAX_EDITOR_SELECTED_TEXT_LENGTH + 1)]);

    expect(readSelectedTextWithinBudget(doc, 1, 1)).toBeUndefined();
    expect(readSelectedTextWithinBudget(doc, 0, MAX_EDITOR_SELECTED_TEXT_LENGTH + 1)).toBeUndefined();
  });

  it("handles reversed ranges", () => {
    const doc = Text.of(["hello"]);

    expect(readSelectedTextWithinBudget(doc, 5, 0)).toBe("hello");
  });
});
