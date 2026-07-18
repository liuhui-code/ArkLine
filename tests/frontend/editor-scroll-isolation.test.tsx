import { fireEvent, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

const recordRenderPressure = vi.hoisted(() => vi.fn());

vi.mock("@/features/performance/use-ui-latency-monitor", () => ({ recordRenderPressure }));

describe("editor scroll isolation", () => {
  it("keeps burst scrolling inside CodeMirror without publishing editor state", () => {
    const onChange = vi.fn();
    const onDocumentChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onCaretRectChange = vi.fn();
    const content = Array.from({ length: 800 }, (_, index) => `function item${index}() { return ${index}; }`).join("\n");

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="/workspace/Entry.ets"
        value={content}
        onChange={onChange}
        onDocumentChange={onDocumentChange}
        onSelectionChange={onSelectionChange}
        onCaretRectChange={onCaretRectChange}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    const root = editor.closest(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(root)!;
    const initialRenderCount = editorRenderCount();
    onCaretRectChange.mockClear();

    for (let index = 1; index <= 100; index += 1) {
      view.scrollDOM.scrollTop = index * 40;
      fireEvent.scroll(view.scrollDOM);
    }

    expect(editorRenderCount()).toBe(initialRenderCount);
    expect(onChange).not.toHaveBeenCalled();
    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onCaretRectChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Editor Content").closest(".cm-editor")).toBe(root);
  });
});

function editorRenderCount() {
  return recordRenderPressure.mock.calls.filter(([label]) => label === "Editor/ArkTsEditor").length;
}
