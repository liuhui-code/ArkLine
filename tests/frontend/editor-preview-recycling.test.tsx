import { render, screen } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

describe("editor preview recycling", () => {
  it("reuses one editor state across transient preview navigation", () => {
    const createState = vi.spyOn(EditorState, "create");
    const appearance = defaultSettings().editor;
    const { rerender } = render(
      <ArkTsEditor
        appearance={appearance}
        path="C:/demo/File0.ets"
        value="file 0"
        onChange={() => undefined}
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
          transientPreview
        />,
      );
    }

    expect(createState).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("file 100");
    createState.mockRestore();
  });
});
