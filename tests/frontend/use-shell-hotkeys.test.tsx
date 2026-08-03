import { fireEvent, render } from "@testing-library/react";
import { vi } from "vitest";
import { useShellHotkeys } from "@/components/layout/useShellHotkeys";

describe("useShellHotkeys", () => {
  it("consumes resolved shell commands before editor-local key handlers", () => {
    const onCommand = vi.fn();
    const onEditorKeyDown = vi.fn();

    function Harness() {
      useShellHotkeys({ onCommand });
      return <input aria-label="Editor" onKeyDown={onEditorKeyDown} />;
    }

    const { getByLabelText } = render(<Harness />);
    fireEvent.keyDown(getByLabelText("Editor"), {
      key: "r",
      ctrlKey: true,
      shiftKey: true,
    });

    expect(onCommand).toHaveBeenCalledWith("openReplaceInFiles");
    expect(onEditorKeyDown).not.toHaveBeenCalled();
  });

  it("leaves unmatched editor shortcuts untouched", () => {
    const onCommand = vi.fn();
    const onEditorKeyDown = vi.fn();

    function Harness() {
      useShellHotkeys({ onCommand });
      return <input aria-label="Editor" onKeyDown={onEditorKeyDown} />;
    }

    const { getByLabelText } = render(<Harness />);
    fireEvent.keyDown(getByLabelText("Editor"), {
      key: "f",
      ctrlKey: true,
    });

    expect(onCommand).not.toHaveBeenCalled();
    expect(onEditorKeyDown).toHaveBeenCalledTimes(1);
  });

  it("defers to a specialized capture handler that already consumed the event", () => {
    const onCommand = vi.fn();

    function Harness() {
      useShellHotkeys({ onCommand });
      return <input aria-label="Editor" />;
    }

    const { getByLabelText } = render(<Harness />);
    const event = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    getByLabelText("Editor").dispatchEvent(event);

    expect(onCommand).not.toHaveBeenCalled();
  });

  it("leaves Ctrl+Space to CodeMirror while completion is available", () => {
    const onCommand = vi.fn();
    const onEditorKeyDown = vi.fn();

    function Harness() {
      useShellHotkeys({ onCommand });
      return <div className="cm-editor"><input aria-label="Editor" onKeyDown={onEditorKeyDown} /></div>;
    }

    const editor = render(<Harness />).getByLabelText("Editor");
    fireEvent.keyDown(editor, { key: " ", code: "Space", ctrlKey: true });

    expect(onCommand).not.toHaveBeenCalled();
    expect(onEditorKeyDown).toHaveBeenCalledTimes(1);
  });

  it("keeps Ctrl+Space at the shell while settings are applying", () => {
    const onCommand = vi.fn();

    function Harness() {
      useShellHotkeys({ context: { settingsApplying: true }, onCommand });
      return <div className="cm-editor"><input aria-label="Editor" /></div>;
    }

    const editor = render(<Harness />).getByLabelText("Editor");
    fireEvent.keyDown(editor, { key: " ", code: "Space", ctrlKey: true });

    expect(onCommand).toHaveBeenCalledWith("openCompletion");
  });

  it("leaves Escape to CodeMirror while its completion tooltip is open", () => {
    const onCommand = vi.fn();
    const onEditorKeyDown = vi.fn();

    function Harness() {
      useShellHotkeys({ onCommand });
      return (
        <div>
          <div className="cm-editor"><input aria-label="Editor" onKeyDown={onEditorKeyDown} /></div>
          <div className="cm-tooltip-autocomplete" />
        </div>
      );
    }

    const editor = render(<Harness />).getByLabelText("Editor");
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(onCommand).not.toHaveBeenCalled();
    expect(onEditorKeyDown).toHaveBeenCalledTimes(1);
  });

  it("does not treat Shift presses used for camel-case input as Double Shift", () => {
    const onCommand = vi.fn();

    function Harness() {
      useShellHotkeys({ onCommand });
      return <input aria-label="Query" />;
    }

    const query = render(<Harness />).getByLabelText("Query");
    fireEvent.keyDown(query, { key: "Shift" });
    fireEvent.keyDown(query, { key: "S", shiftKey: true });
    fireEvent.keyDown(query, { key: "Shift" });
    fireEvent.keyDown(query, { key: "N", shiftKey: true });

    expect(onCommand).not.toHaveBeenCalledWith("openSearchEverywhere");
  });

  it("still opens Search Everywhere for two uninterrupted Shift taps", () => {
    const onCommand = vi.fn();

    function Harness() {
      useShellHotkeys({ onCommand });
      return <input aria-label="Query" />;
    }

    const query = render(<Harness />).getByLabelText("Query");
    fireEvent.keyDown(query, { key: "Shift" });
    fireEvent.keyDown(query, { key: "Shift" });

    expect(onCommand).toHaveBeenCalledWith("openSearchEverywhere");
  });
});
