import { render, screen } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

describe("editor preview recycling", () => {
  it("resets per-document state across transient preview navigation and remains editable", async () => {
    const user = userEvent.setup();
    const createState = vi.spyOn(EditorState, "create");
    const appearance = defaultSettings().editor;
    const { rerender } = render(
      <ArkTsEditor
        appearance={appearance}
        path="C:/demo/File0.ets"
        value="file 0"
        onChange={() => undefined}
        onDocumentChange={() => undefined}
        transientPreview
      />,
    );

    for (let index = 1; index <= 100; index += 1) {
      rerender(
        <ArkTsEditor
          appearance={appearance}
          path={`C:/demo/File${index}.ets`}
          value={`file ${index}`}
          onChange={() => undefined}
          onDocumentChange={() => undefined}
          transientPreview
        />,
      );
    }

    expect(createState).toHaveBeenCalledTimes(1);
    const editor = screen.getByLabelText("Editor Content");
    expect(editor).toHaveTextContent("file 100");
    await user.click(editor);
    await user.keyboard("queryState");
    expect(editor).toHaveTextContent("queryState");
    expect(editor).toHaveAttribute("data-document-change-count", "10");
    expect(editor).toHaveAttribute("data-external-replacement-count", "0");
    createState.mockRestore();
  });
});
