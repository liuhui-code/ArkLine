import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";
import { EditorView } from "@codemirror/view";
import { vi } from "vitest";

describe("ArkTsEditor", () => {
  it("renders the initial document and reports edits", async () => {
    const user = userEvent.setup();
    const changes: string[] = [];

    const { container } = render(
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

    const { container } = render(
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

  it("reports modifier-hover state for definition affordance", () => {
    const onDefinitionHoverChange = vi.fn();
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(7);

    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"@Entry\nstruct Index {}"}
        onChange={() => undefined}
        onDefinitionHoverChange={onDefinitionHoverChange}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    fireEvent.mouseMove(editor, {
      ctrlKey: true,
      clientX: 24,
      clientY: 24,
    });
    fireEvent.mouseLeave(editor);

    expect(onDefinitionHoverChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        active: true,
        selection: { line: 2, column: 1 },
      }),
    );
    expect(onDefinitionHoverChange).toHaveBeenLastCalledWith({ active: false });
    posAtCoords.mockRestore();
  });

  it("highlights only the hovered definition token while modifier-hovering", () => {
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(10);

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"@Entry\nstruct Index {}"}
        onChange={() => undefined}
        onDefinitionHoverChange={() => undefined}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    fireEvent.mouseMove(editor, {
      ctrlKey: true,
      clientX: 24,
      clientY: 24,
    });

    const hoverMark = editor.querySelector(".cm-arkline-definition-hover");
    expect(hoverMark).toBeTruthy();
    expect(hoverMark).toHaveTextContent("struct");

    fireEvent.mouseLeave(editor);
    expect(editor.querySelector(".cm-arkline-definition-hover")).toBeNull();

    posAtCoords.mockRestore();
  });

  it("uses centered scrolling when jumping to a target location", () => {
    const scrollIntoView = vi.spyOn(EditorView, "scrollIntoView");

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"line 1\nline 2\nline 3\nline 4\nline 5"}
        selectionTarget={{ line: 4, column: 1, nonce: 1 }}
        onChange={() => undefined}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ y: "center" }));
    scrollIntoView.mockRestore();
  });

  it("briefly reveals the jumped token after navigation", () => {
    vi.useFakeTimers();

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"line 1\nstruct Index {\n  build() {}\n}"}
        selectionTarget={{ line: 2, column: 8, nonce: 1 }}
        onChange={() => undefined}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    const revealMark = editor.querySelector(".cm-arkline-jump-reveal");
    expect(revealMark).toBeTruthy();
    expect(revealMark).toHaveTextContent("Index");

    vi.advanceTimersByTime(1300);
    expect(editor.querySelector(".cm-arkline-jump-reveal")).toBeNull();

    vi.useRealTimers();
  });

  it("renders git blame labels and forwards blame clicks", async () => {
    const user = userEvent.setup();
    const onGitTraceLineClick = vi.fn();

    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"@Entry\nstruct Index {}"}
        blameLines={[
          {
            line: 1,
            commit: "abc1234",
            sourceLine: 1,
            author: "Jane Doe",
            authoredAt: "2026-06-23T10:00:00Z",
            relativeTime: "2h ago",
            summary: "Mark ArkTS entry component",
          },
        ]}
        selectedBlameLine={1}
        onGitTraceLineClick={onGitTraceLineClick}
        onChange={() => undefined}
      />,
    );

    const blameButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(".cm-git-trace-marker");
      expect(button).toBeTruthy();
      return button!;
    });
    expect(blameButton).toHaveClass("cm-git-trace-marker--active");
    expect(blameButton).toHaveAttribute(
      "aria-label",
      "Git Trace Line 1 Jane Doe 2h ago Mark ArkTS entry component",
    );

    await user.click(blameButton);
    expect(onGitTraceLineClick).toHaveBeenCalledWith(1);
  });
});
