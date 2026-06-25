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
  | "showCurrentClassMethods"
  | "showCodeActions"
  | "renameSymbol"
  | "generateCode"
  | "refactorThis"
  | "openCompletion"
  | "save";

export const shellCommandDescriptors: CommandDescriptor<ShellCommand>[] = [
  { id: "hideActiveToolWindow", title: "Hide Active Tool Window", category: "Window", defaultKeybindings: [{ shift: true, key: "Escape" }] },
  { id: "closeTransientUi", title: "Close", category: "Window", defaultKeybindings: [{ key: "Escape" }] },
  { id: "closeActiveFile", title: "Close Active File", category: "File", defaultKeybindings: [{ mod: true, key: "w" }] },
  { id: "navigateBack", title: "Navigate Back", category: "Navigation", defaultKeybindings: [{ mod: true, alt: true, key: "ArrowLeft" }] },
  { id: "findUsages", title: "Find Usages", category: "Navigation", defaultKeybindings: [{ alt: true, key: "F7" }] },
  { id: "showCurrentClassMethods", title: "Show Current Class Methods", category: "Navigation", defaultKeybindings: [{ ctrl: true, key: "F7" }] },
  { id: "showCodeActions", title: "Show Code Actions", category: "Editor", defaultKeybindings: [{ alt: true, key: "Enter" }], when: editorCommandAvailable },
  { id: "renameSymbol", title: "Rename Symbol", category: "Refactor", defaultKeybindings: [{ key: "F2" }], when: editorCommandAvailable },
  { id: "generateCode", title: "Generate Code", category: "Generate", defaultKeybindings: [{ alt: true, key: "Insert" }], when: editorCommandAvailable },
  { id: "refactorThis", title: "Refactor This", category: "Refactor", defaultKeybindings: [{ ctrl: true, alt: true, shift: true, key: "T" }], when: editorCommandAvailable },
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

function editorCommandAvailable(context: KeybindingContext) {
  return !context.overlayOpen && !context.settingsOpen && !context.settingsApplying;
}

export function resolveShellCommand(event: KeyboardEvent, context: KeybindingContext = {}): ShellCommand | null {
  return resolveKeybindingCommand(event, shellCommandDescriptors, context);
}

export function getShellCommandShortcut(command: ShellCommand) {
  const descriptor = shellCommandDescriptors.find((item) => item.id === command);
  return descriptor ? formatCommandShortcut(descriptor) : undefined;
}
