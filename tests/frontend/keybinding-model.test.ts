import { describe, expect, it } from "vitest";
import {
  buildKeybindingInventory,
  formatKeybinding,
  matchesKeybinding,
  resolveKeybindingCommand,
  type CommandDescriptor,
} from "@/components/layout/keybinding-model";

type TestCommand = "save" | "goToDefinition" | "hideToolWindow";

const commands: CommandDescriptor<TestCommand>[] = [
  {
    id: "goToDefinition",
    title: "Go to Definition",
    category: "Navigation",
    defaultKeybindings: [{ mod: true, key: "b" }],
    when: (context) => !context.settingsApplying,
  },
  {
    id: "save",
    title: "Save",
    category: "File",
    defaultKeybindings: [{ mod: true, key: "s" }],
  },
  {
    id: "hideToolWindow",
    title: "Hide Active Tool Window",
    category: "Window",
    defaultKeybindings: [{ shift: true, key: "Escape" }],
  },
];

function keyEvent(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", init);
}

describe("keybinding model", () => {
  it("matches Mod shortcuts with either Ctrl or Meta", () => {
    expect(matchesKeybinding(keyEvent({ key: "s", ctrlKey: true }), { mod: true, key: "s" })).toBe(true);
    expect(matchesKeybinding(keyEvent({ key: "s", metaKey: true }), { mod: true, key: "s" })).toBe(true);
    expect(matchesKeybinding(keyEvent({ key: "s", ctrlKey: true, metaKey: true }), { mod: true, key: "s" })).toBe(false);
  });

  it("resolves commands by keybinding and context", () => {
    expect(resolveKeybindingCommand(keyEvent({ key: "b", ctrlKey: true }), commands)).toBe("goToDefinition");
    expect(resolveKeybindingCommand(keyEvent({ key: "b", ctrlKey: true }), commands, { settingsApplying: true })).toBeNull();
  });

  it("keeps shifted Escape distinct from bare Escape", () => {
    expect(resolveKeybindingCommand(keyEvent({ key: "Escape", shiftKey: true }), commands)).toBe("hideToolWindow");
    expect(resolveKeybindingCommand(keyEvent({ key: "Escape" }), commands)).toBeNull();
  });

  it("formats shortcuts for default and mac displays", () => {
    expect(formatKeybinding({ mod: true, shift: true, key: "a" }, "default")).toBe("Ctrl+Shift+A");
    expect(formatKeybinding({ mod: true, shift: true, key: "a" }, "mac")).toBe("Cmd+Shift+A");
    expect(formatKeybinding({ alt: true, key: "F7" }, "default")).toBe("Alt+F7");
  });

  it("marks duplicate default shortcuts as conflicts", () => {
    const inventory = buildKeybindingInventory([
      ...commands,
      {
        id: "duplicateSave",
        title: "Duplicate Save",
        category: "File",
        defaultKeybindings: [{ mod: true, key: "s" }],
      },
    ], "default");

    const save = inventory.find((item) => item.commandId === "save");
    const duplicate = inventory.find((item) => item.commandId === "duplicateSave");
    const definition = inventory.find((item) => item.commandId === "goToDefinition");

    expect(save?.source).toBe("Default");
    expect(save?.status).toBe("Conflict");
    expect(save?.conflicts).toEqual(["Duplicate Save"]);
    expect(duplicate?.status).toBe("Conflict");
    expect(definition?.status).toBe("Active");
  });
});
