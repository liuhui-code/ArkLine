import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { MAX_EDITOR_SELECTED_TEXT_LENGTH } from "@/editor/editor-selection-budget";
import { defaultSettings } from "@/features/settings/settings-store";

describe("ArkTsEditor selection payload budget", () => {
  it("forwards small selected text", async () => {
    const onSelectionChange = vi.fn();

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value="hello world"
        onChange={() => undefined}
        onSelectionChange={onSelectionChange}
      />,
    );

    selectText(0, 5);

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedText: "hello" }));
    });
  });

  it("omits oversized selected text while preserving caret position", async () => {
    const onSelectionChange = vi.fn();
    const value = "x".repeat(MAX_EDITOR_SELECTED_TEXT_LENGTH + 1);

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/large.ets"
        value={value}
        onChange={() => undefined}
        onSelectionChange={onSelectionChange}
      />,
    );

    selectText(0, value.length);

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenLastCalledWith({
        line: 1,
        column: value.length + 1,
        selectedText: undefined,
      });
    });
  });
});

function selectText(from: number, to: number) {
  const editor = screen.getByLabelText("Editor Content");
  const view = EditorView.findFromDOM(editor);
  view?.dispatch({ selection: EditorSelection.range(from, to) });
}
