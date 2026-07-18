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
});
