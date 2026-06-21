import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";
import { EditorView } from "@codemirror/view";
import { vi } from "vitest";

describe("ArkTsEditor", () => {
  it("renders the initial document and reports edits", async () => {
    const user = userEvent.setup();
    const changes: string[] = [];

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value="@Entry\nstruct Index {}"
        onChange={(value) => changes.push(value)}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{End}\n// edit");

    expect(changes.at(-1)).toContain("// edit");
  });

  it("accepts external value updates without losing content", () => {
    const { rerender } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value="@Entry\nstruct Index {}"
        onChange={() => undefined}
      />,
    );

    rerender(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value="@Entry\nstruct Index {\n  build() {}\n}"
        onChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("build() {}");
  });

  it("keeps the same editor instance across controlled updates while typing", async () => {
    const user = userEvent.setup();

    function ControlledEditor() {
      const [value, setValue] = useState("ABCD");

      return (
        <ArkTsEditor
          appearance={defaultSettings().editor}
          path="C:/demo/main.ets"
          value={value}
          onChange={setValue}
        />
      );
    }

    render(<ControlledEditor />);

    const editor = screen.getByLabelText("Editor Content");
    const initialEditorRoot = editor.closest(".cm-editor");
    await user.click(editor);
    await user.keyboard("{End}");
    await user.keyboard("1");
    const updatedEditor = screen.getByLabelText("Editor Content");
    expect(updatedEditor.closest(".cm-editor")).toBe(initialEditorRoot);
    await user.keyboard("2");

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("ABCD12");
    expect(screen.getByLabelText("Editor Content").closest(".cm-editor")).toBe(initialEditorRoot);
  });

  it("replaces the current selection and supports undo redo history", async () => {
    const user = userEvent.setup();

    function ControlledEditor() {
      const [value, setValue] = useState("abcd");

      return (
        <ArkTsEditor
          appearance={defaultSettings().editor}
          path="C:/demo/main.ets"
          value={value}
          onChange={setValue}
        />
      );
    }

    render(<ControlledEditor />);

    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{End}{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}x");
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("abx");

    await user.keyboard("y");
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("abxy");

    await user.keyboard("{Control>}z{/Control}");
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("abcd");

    await user.keyboard("{Control>}y{/Control}");
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("abxy");
  });

  it("continues typing at the moved caret position", async () => {
    const user = userEvent.setup();

    function ControlledEditor() {
      const [value, setValue] = useState("abcd");

      return (
        <ArkTsEditor
          appearance={defaultSettings().editor}
          path="C:/demo/main.ets"
          value={value}
          onChange={setValue}
        />
      );
    }

    render(<ControlledEditor />);

    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{End}{ArrowLeft}{ArrowLeft}X");

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("abXcd");
  });

  it("replaces a large multi-line selection", async () => {
    const user = userEvent.setup();

    function ControlledEditor() {
      const [value, setValue] = useState("@Entry\n@Component\nstruct Index {}");

      return (
        <ArkTsEditor
          appearance={defaultSettings().editor}
          path="C:/demo/main.ets"
          value={value}
          onChange={setValue}
        />
      );
    }

    render(<ControlledEditor />);

    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}");
    await user.keyboard("X");

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("X");
  });

  it("replaces a mouse-drag multi-line selection", async () => {
    const user = userEvent.setup();

    function ControlledEditor() {
      const [value, setValue] = useState("@Entry\n@Component\nstruct Index {}");

      return (
        <ArkTsEditor
          appearance={defaultSettings().editor}
          path="C:/demo/main.ets"
          value={value}
          onChange={setValue}
        />
      );
    }

    render(<ControlledEditor />);

    const editor = screen.getByLabelText("Editor Content");
    const lines = editor.querySelectorAll(".cm-line");
    const startLine = lines[0] as HTMLElement | undefined;
    const endLine = lines[2] as HTMLElement | undefined;

    expect(startLine).toBeDefined();
    expect(endLine).toBeDefined();

    await user.pointer([
      { target: startLine!, keys: "[MouseLeft>]" },
      { target: endLine! },
      { keys: "[/MouseLeft]" },
    ]);
    await user.keyboard("X");

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("X");
  });

  it("forwards Ctrl+Click document position into the definition trigger", async () => {
    const onDefinitionTrigger = vi.fn();
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(7);

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"@Entry\nstruct Index {}"}
        onChange={() => undefined}
        onDefinitionTrigger={onDefinitionTrigger}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    fireEvent.mouseDown(editor, {
      ctrlKey: true,
      button: 0,
      clientX: 24,
      clientY: 24,
    });

    expect(onDefinitionTrigger).toHaveBeenCalledWith({ line: 2, column: 1 });
    posAtCoords.mockRestore();
  });
});
