import { describe, expect, it } from "vitest";
import { resolveShellCommand } from "@/components/layout/shell-keymap";

function keyboardEvent(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", init);
}

describe("shell keymap", () => {
  it("maps Ctrl+Alt+L to format document", () => {
    expect(resolveShellCommand(keyboardEvent({ key: "l", ctrlKey: true, altKey: true }))).toBe("formatDocument");
  });

  it("does not format while modal UI is active", () => {
    const event = keyboardEvent({ key: "l", ctrlKey: true, altKey: true });

    expect(resolveShellCommand(event, { overlayOpen: true })).toBeNull();
    expect(resolveShellCommand(event, { settingsOpen: true })).toBeNull();
    expect(resolveShellCommand(event, { settingsApplying: true })).toBeNull();
  });
});
