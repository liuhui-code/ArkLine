import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { arkLineHighlightStyle } from "@/editor/theme";
import { defaultSettings } from "@/features/settings/settings-store";
import { EditorView } from "@codemirror/view";
import { tags, type Tag } from "@lezer/highlight";
import { vi } from "vitest";

describe("ArkTsEditor", () => {
  it("maps code reading colors across common ArkTS token groups", () => {
    expect(highlightColorFor(tags.keyword)).toBe("#c792ea");
    expect(highlightColorFor(tags.function(tags.variableName))).toBe("#dcdcaa");
    expect(highlightColorFor(tags.propertyName)).toBe("#9cdcfe");
    expect(highlightColorFor(tags.comment)).toBe("#768390");
    expect(highlightColorFor(tags.self)).toBe("#82aaff");
    expect(highlightColorFor(tags.escape)).toBe("#f78c6c");
    expect(highlightColorFor(tags.invalid)).toBe("#ff7b72");
  });

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

  it("renders editable text before enabling structural language enhancements", () => {
    let idleCallback: (() => void) | null = null;
    const requestIdleCallback = vi.fn((callback: () => void) => {
      idleCallback = callback;
      return 1;
    });
    const cancelIdleCallback = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", {
      value: requestIdleCallback,
      configurable: true,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      value: cancelIdleCallback,
      configurable: true,
    });

    const { container, unmount } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"struct Entry {\n  build() {}\n}"}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("build() {}");
    expect(container.querySelector(".cm-foldGutter")).toBeNull();
    act(() => idleCallback?.());
    expect(container.querySelector(".cm-foldGutter")).not.toBeNull();

    unmount();
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
  });

  it("cancels stale enhancement work when navigation switches files", () => {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 0;
    const requestIdleCallback = vi.fn((callback: () => void) => {
      nextHandle += 1;
      callbacks.set(nextHandle, callback);
      return nextHandle;
    });
    const cancelIdleCallback = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", {
      value: requestIdleCallback,
      configurable: true,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      value: cancelIdleCallback,
      configurable: true,
    });
    const appearance = defaultSettings().editor;
    const { container, rerender, unmount } = render(
      <ArkTsEditor appearance={appearance} path="C:/demo/A.ets" value="struct A {}" onChange={() => undefined} />,
    );

    rerender(
      <ArkTsEditor appearance={appearance} path="C:/demo/B.ets" value="struct B {}" onChange={() => undefined} />,
    );
    expect(cancelIdleCallback).toHaveBeenCalledWith(1);
    act(() => callbacks.get(1)?.());
    expect(container.querySelector(".cm-foldGutter")).toBeNull();
    act(() => callbacks.get(2)?.());
    expect(container.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("struct B {}");

    unmount();
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
  });

  it("publishes persistent documents without creating string snapshots", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onDocumentChange = vi.fn();

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value="A"
        onChange={onChange}
        onDocumentChange={onDocumentChange}
      />,
    );

    await user.click(screen.getByLabelText("Editor Content"));
    await user.keyboard("{End}B");

    expect(onDocumentChange).toHaveBeenCalled();
    expect(onDocumentChange.mock.lastCall?.[0].toString()).toBe("AB");
    expect(onChange).not.toHaveBeenCalled();
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

  it("switches files in one persistent view with isolated undo history", async () => {
    const user = userEvent.setup();
    let activePath = "C:/demo/A.ets";
    let activeValue = "A";
    const values = new Map([[activePath, activeValue], ["C:/demo/B.ets", "B"]]);
    const onChange = (value: string) => {
      activeValue = value;
      values.set(activePath, value);
    };
    const { rerender } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path={activePath}
        value={activeValue}
        onChange={onChange}
      />,
    );
    const initialRoot = screen.getByLabelText("Editor Content").closest(".cm-editor");

    await user.click(screen.getByLabelText("Editor Content"));
    await user.keyboard("{End}1");
    activePath = "C:/demo/B.ets";
    activeValue = values.get(activePath)!;
    rerender(
      <ArkTsEditor appearance={defaultSettings().editor} path={activePath} value={activeValue} onChange={onChange} />,
    );
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("B");
    expect(screen.getByLabelText("Editor Content").closest(".cm-editor")).toBe(initialRoot);

    await user.keyboard("{End}2{Control>}z{/Control}");
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("B");
    activePath = "C:/demo/A.ets";
    activeValue = values.get(activePath)!;
    rerender(
      <ArkTsEditor appearance={defaultSettings().editor} path={activePath} value={activeValue} onChange={onChange} />,
    );
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("A1");

    await user.keyboard("{Control>}z{/Control}");
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("A");
  });

  it("survives repeated cross-file switches without replacing the editor view", () => {
    const appearance = defaultSettings().editor;
    const { rerender } = render(
      <ArkTsEditor appearance={appearance} path="C:/demo/File0.ets" value="file 0" onChange={() => undefined} />,
    );
    const initialRoot = screen.getByLabelText("Editor Content").closest(".cm-editor");

    for (let index = 1; index <= 20; index += 1) {
      rerender(
        <ArkTsEditor
          appearance={appearance}
          path={`C:/demo/File${index}.ets`}
          value={`file ${index}`}
          onChange={() => undefined}
        />,
      );
    }

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("file 20");
    expect(screen.getByLabelText("Editor Content").closest(".cm-editor")).toBe(initialRoot);
  });

  it("restores the scroll position for each file session", async () => {
    const appearance = defaultSettings().editor;
    const { rerender } = render(
      <ArkTsEditor appearance={appearance} path="C:/demo/A.ets" value="A" onChange={() => undefined} />,
    );
    const root = screen.getByLabelText("Editor Content").closest(".cm-editor");
    const view = EditorView.findFromDOM(root as HTMLElement)!;
    view.scrollDOM.scrollTop = 120;
    view.scrollDOM.scrollLeft = 18;

    rerender(
      <ArkTsEditor appearance={appearance} path="C:/demo/B.ets" value="B" onChange={() => undefined} />,
    );
    view.scrollDOM.scrollTop = 36;
    rerender(
      <ArkTsEditor appearance={appearance} path="C:/demo/A.ets" value="A" onChange={() => undefined} />,
    );

    await waitFor(() => expect(view.scrollDOM.scrollTop).toBe(120));
    expect(view.scrollDOM.scrollLeft).toBe(18);
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

  it("opens the editor search panel with Ctrl+F", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value="@Entry\nstruct Index {}"
        onChange={() => undefined}
      />,
    );
    await user.click(screen.getByLabelText("Editor Content"));
    await user.keyboard("{Control>}f{/Control}");
    const searchPanel = container.querySelector(".cm-panel.cm-search");
    expect(searchPanel).toBeInTheDocument();
    expect(searchPanel?.querySelector("input[name=search]")).toHaveAttribute("aria-label", "Find");
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

  it("snaps Ctrl+Click from a member-access dot to the following definition token", () => {
    const onDefinitionTrigger = vi.fn();
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(10);

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"Text(\"Hi\").width(100)"}
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

    expect(onDefinitionTrigger).toHaveBeenCalledWith({ line: 1, column: 12 });
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
    expect(editor).toHaveStyle({ cursor: "pointer" });
    fireEvent.mouseLeave(editor);

    expect(onDefinitionHoverChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        active: true,
        selection: { line: 2, column: 1 },
      }),
    );
    expect(onDefinitionHoverChange).toHaveBeenLastCalledWith({ active: false });
    expect(editor).not.toHaveStyle({ cursor: "pointer" });
    posAtCoords.mockRestore();
  });

  it("owns definition hover cursor state without a React callback", () => {
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(7);

    render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"@Entry\nstruct Index {}"}
        onChange={() => undefined}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    fireEvent.mouseMove(editor, {
      ctrlKey: true,
      clientX: 24,
      clientY: 24,
    });

    expect(editor).toHaveStyle({ cursor: "pointer" });
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

  it("switches navigation targets without remounting the editor view", () => {
    const { rerender } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/source.ets"
        value={"const source = 1;"}
        onChange={() => undefined}
      />,
    );

    rerender(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/target.ets"
        value={"declare class Target {\n  width(value: number): void;\n}"}
        selectionTarget={{ line: 2, column: 3, nonce: 1 }}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("width(value: number): void");
  });

  it("does not crash when a jump target contains non-finite coordinates", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"line 1\nline 2"}
        selectionTarget={{ line: Number.NaN, column: Number.POSITIVE_INFINITY, nonce: 1 }}
        onChange={() => undefined}
      />,
    )).not.toThrow();

    consoleError.mockRestore();
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
        gitBlameVisible
        blameAttributions={[
          {
            bufferLine: 1,
            commit: "abc1234",
            shortCommit: "abc1234",
            sourceLine: 1,
            status: "committed",
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

  it("removes the git blame gutter when full-file blame is hidden", () => {
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"@Entry\nstruct Index {}"}
        gitBlameVisible={false}
        blameAttributions={[
          {
            bufferLine: 1,
            commit: "abc1234",
            shortCommit: "abc1234",
            sourceLine: 1,
            status: "committed",
            author: "Jane Doe",
            authoredAt: "2026-06-23T10:00:00Z",
            relativeTime: "2h ago",
            summary: "Mark ArkTS entry component",
          },
        ]}
        selectedBlameLine={1}
        onChange={() => undefined}
      />,
    );

    expect(container.querySelector(".cm-git-trace-gutter")).toBeNull();
  });
});

function highlightColorFor(tag: Tag) {
  const spec = arkLineHighlightStyle.specs.find((item) => {
    const target = item.tag;
    return Array.isArray(target) ? target.includes(tag) : target === tag;
  });
  return spec && "color" in spec ? spec.color : undefined;
}
