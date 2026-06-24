import {
  formatCommandShortcut,
  resolveKeybindingCommand,
  type CommandDescriptor,
  type KeybindingContext,
} from "@/components/layout/keybinding-model";

export type ShellCommand =
  | "closeTransientUi"
  | "closeActiveFile"
  | "hideActiveToolWindow"
  | "navigateBack"
  | "toggleEditorOnly"
  | "openQuickOpen"
  | "openSearchEverywhere"
  | "openRecentFiles"
  | "openCommandPalette"
  | "showProject"
  | "showProblems"
  | "showGit"
  | "showTerminal"
  | "goToDefinition"
  | "findUsages"
  | "openCompletion"
  | "save";

export const shellCommandDescriptors: CommandDescriptor<ShellCommand>[] = [
  { id: "hideActiveToolWindow", title: "Hide Active Tool Window", category: "Window", defaultKeybindings: [{ shift: true, key: "Escape" }] },
  { id: "closeTransientUi", title: "Close", category: "Window", defaultKeybindings: [{ key: "Escape" }] },
  { id: "closeActiveFile", title: "Close Active File", category: "File", defaultKeybindings: [{ mod: true, key: "w" }] },
  { id: "navigateBack", title: "Navigate Back", category: "Navigation", defaultKeybindings: [{ mod: true, alt: true, key: "ArrowLeft" }] },
  { id: "findUsages", title: "Find Usages", category: "Navigation", defaultKeybindings: [{ alt: true, key: "F7" }] },
  { id: "toggleEditorOnly", title: "Editor Only", category: "Window", defaultKeybindings: [{ mod: true, shift: true, key: "F12" }] },
  { id: "save", title: "Save", category: "File", defaultKeybindings: [{ mod: true, key: "s" }] },
  { id: "goToDefinition", title: "Go to Definition", category: "Navigation", defaultKeybindings: [{ mod: true, key: "b" }] },
  { id: "openCompletion", title: "Code Completion", category: "Editor", defaultKeybindings: [{ mod: true, key: "Space" }] },
  { id: "openQuickOpen", title: "Quick Open", category: "Navigation", defaultKeybindings: [{ mod: true, key: "p" }] },
  { id: "openCommandPalette", title: "Command Palette", category: "Navigation", defaultKeybindings: [{ mod: true, shift: true, key: "a" }] },
  { id: "openRecentFiles", title: "Recent Files", category: "Navigation", defaultKeybindings: [{ mod: true, key: "e" }] },
  { id: "showProject", title: "Project", category: "Window", defaultKeybindings: [{ alt: true, key: "1" }] },
  { id: "showProblems", title: "Problems", category: "Window", defaultKeybindings: [{ alt: true, key: "4" }] },
  { id: "showGit", title: "Git", category: "Window", defaultKeybindings: [{ alt: true, key: "9" }] },
  { id: "showTerminal", title: "Terminal", category: "Window", defaultKeybindings: [{ alt: true, key: "F12" }] },
];

export function isBareShift(event: KeyboardEvent) {
  return event.key === "Shift" && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function resolveShellCommand(event: KeyboardEvent, context: KeybindingContext = {}): ShellCommand | null {
  return resolveKeybindingCommand(event, shellCommandDescriptors, context);
}

export function getShellCommandShortcut(command: ShellCommand) {
  const descriptor = shellCommandDescriptors.find((item) => item.id === command);
  return descriptor ? formatCommandShortcut(descriptor) : undefined;
}
