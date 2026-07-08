import { fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD } from "@/editor/editor-document-budget";
import { defaultSettings } from "@/features/settings/settings-store";

describe("ArkTsEditor large document mode", () => {
  it("skips modifier-hover decorations for large files", () => {
    const onDefinitionHoverChange = vi.fn();
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(1);

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/large.ets"
        value={`A${"x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD)}`}
        onChange={() => undefined}
        onDefinitionHoverChange={onDefinitionHoverChange}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    fireEvent.mouseMove(editor, { ctrlKey: true, clientX: 24, clientY: 24 });

    expect(onDefinitionHoverChange).not.toHaveBeenCalled();
    expect(editor.querySelector(".cm-arkline-definition-hover")).toBeNull();
    posAtCoords.mockRestore();
  });

  it("skips full-file git blame gutter for large files", () => {
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/large.ets"
        value={`A${"x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD)}`}
        gitBlameVisible
        blameAttributions={[{
          bufferLine: 1,
          commit: "abc1234",
          shortCommit: "abc1234",
          sourceLine: 1,
          status: "committed",
          author: "Jane Doe",
          authoredAt: "2026-06-23T10:00:00Z",
          relativeTime: "2h ago",
          summary: "Mark entry component",
        }]}
        selectedBlameLine={1}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector(".cm-git-trace-gutter")).toBeNull();
  });
});
