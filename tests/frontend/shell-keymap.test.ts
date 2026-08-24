import { describe, expect, it } from "vitest";
import { resolveShellCommand } from "@/components/layout/shell-keymap";

function keyboardEvent(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", init);
}

describe("shell keymap", () => {
  it("maps Ctrl+W to close the focused context", () => {
    expect(resolveShellCommand(keyboardEvent({ key: "w", ctrlKey: true }))).toBe("closeFocusedContext");
  });

  it("maps Ctrl+Alt+L to format document", () => {
    expect(resolveShellCommand(keyboardEvent({ key: "l", ctrlKey: true, altKey: true }))).toBe("formatDocument");
  });

  it("maps IDEA-style Commit and Push Commits shortcuts", () => {
    expect(resolveShellCommand(keyboardEvent({ key: "k", ctrlKey: true }))).toBe("commitChanges");
    expect(resolveShellCommand(keyboardEvent({ key: "k", ctrlKey: true, shiftKey: true }))).toBe("pushCommits");
    expect(resolveShellCommand(keyboardEvent({ key: "k", metaKey: true }))).toBe("commitChanges");
  });

  it("maps paired navigation history shortcuts", () => {
    expect(resolveShellCommand(keyboardEvent({ key: "ArrowLeft", ctrlKey: true, altKey: true }))).toBe("navigateBack");
    expect(resolveShellCommand(keyboardEvent({ key: "ArrowRight", ctrlKey: true, altKey: true }))).toBe("navigateForward");
  });

  it("does not format while modal UI is active", () => {
    const event = keyboardEvent({ key: "l", ctrlKey: true, altKey: true });

    expect(resolveShellCommand(event, { overlayOpen: true })).toBeNull();
    expect(resolveShellCommand(event, { settingsOpen: true })).toBeNull();
    expect(resolveShellCommand(event, { settingsApplying: true })).toBeNull();
  });
});
