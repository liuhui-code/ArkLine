import { fireEvent, render, screen } from "@testing-library/react";
import { typescriptLanguage } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import { vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import {
  EDITOR_REDUCED_RENDER_LINE_THRESHOLD,
  LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD,
} from "@/editor/editor-document-budget";
import { defaultSettings } from "@/features/settings/settings-store";

describe("ArkTsEditor large document mode", () => {
  it("keeps syntax highlighting active beyond the reduced-render line threshold", () => {
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/line-dense.ets"
        value={lineDenseDocument()}
        onChange={() => undefined}
      />,
    );

    expectTypeScriptLanguageActive(container);
  });

  it("keeps syntax highlighting when switching to a reduced-render document", () => {
    const appearance = defaultSettings().editor;
    const onChange = () => undefined;
    const { container, rerender } = render(
      <ArkTsEditor
        appearance={appearance}
        path="C:/demo/readme.txt"
        value="plain text"
        onChange={onChange}
      />,
    );

    rerender(
      <ArkTsEditor
        appearance={appearance}
        path="C:/demo/line-dense.ets"
        value={lineDenseDocument()}
        onChange={onChange}
      />,
    );

    expectTypeScriptLanguageActive(container);
  });

  it("keeps syntax highlighting when an open document crosses the reduced-render threshold", () => {
    const appearance = defaultSettings().editor;
    const onChange = () => undefined;
    const { container, rerender } = render(
      <ArkTsEditor
        appearance={appearance}
        path="C:/demo/growing.ets"
        value="const value = 1;"
        onChange={onChange}
      />,
    );

    rerender(
      <ArkTsEditor
        appearance={appearance}
        path="C:/demo/growing.ets"
        value={lineDenseDocument()}
        onChange={onChange}
      />,
    );

    expectTypeScriptLanguageActive(container);
  });

  it("uses the reduced editor extension set for line-dense files", () => {
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/line-dense.ets"
        value={"const value = 1;\n".repeat(EDITOR_REDUCED_RENDER_LINE_THRESHOLD - 1)}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector(".cm-foldGutter")).toBeNull();
  });

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

  it("coalesces large document change payloads to the next frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const onChange = vi.fn();

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/large.ets"
        value={"x".repeat(LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD)}
        onChange={onChange}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    const root = editor.closest(".cm-editor");
    expect(root).toBeInstanceOf(HTMLElement);
    const view = EditorView.findFromDOM(root as HTMLElement);
    expect(view).toBeTruthy();
    view?.dispatch({ changes: { from: 0, insert: "a" } });
    view?.dispatch({ changes: { from: 0, insert: "b" } });

    expect(onChange).not.toHaveBeenCalled();
    [...callbacks].forEach((callback) => callback(0));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].startsWith("ba")).toBe(true);
    raf.mockRestore();
  });
});

function lineDenseDocument() {
  return "const value = 1;\n".repeat(EDITOR_REDUCED_RENDER_LINE_THRESHOLD - 1);
}

function expectTypeScriptLanguageActive(container: HTMLElement) {
  const root = container.querySelector(".cm-editor");
  expect(root).toBeInstanceOf(HTMLElement);
  const view = EditorView.findFromDOM(root as HTMLElement);

  expect(view).toBeTruthy();
  expect(typescriptLanguage.isActiveAt(view!.state, 0)).toBe(true);
}
