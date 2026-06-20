export type ShellCommand =
  | "closeTransientUi"
  | "hideActiveToolWindow"
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

function isPrimaryModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey;
}

export function isBareShift(event: KeyboardEvent) {
  return event.key === "Shift" && !event.ctrlKey && !event.metaKey && !event.altKey;
}

export function resolveShellCommand(event: KeyboardEvent): ShellCommand | null {
  const key = event.key.toLowerCase();

  if (event.key === "Escape" && event.shiftKey) {
    return "hideActiveToolWindow";
  }

  if (event.key === "Escape") {
    return "closeTransientUi";
  }

  if (event.altKey && key === "f7" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    return "findUsages";
  }

  if (isPrimaryModifier(event) && event.shiftKey && key === "f12") {
    return "toggleEditorOnly";
  }

  if (isPrimaryModifier(event) && key === "s" && !event.shiftKey) {
    return "save";
  }

  if (isPrimaryModifier(event) && key === "b" && !event.shiftKey) {
    return "goToDefinition";
  }

  if (isPrimaryModifier(event) && event.code === "Space" && !event.shiftKey) {
    return "openCompletion";
  }

  if (isPrimaryModifier(event) && key === "p" && !event.shiftKey) {
    return "openQuickOpen";
  }

  if (isPrimaryModifier(event) && event.shiftKey && key === "a") {
    return "openCommandPalette";
  }

  if (isPrimaryModifier(event) && key === "e" && !event.shiftKey) {
    return "openRecentFiles";
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (key === "1") {
      return "showProject";
    }

    if (key === "4") {
      return "showProblems";
    }

    if (key === "9") {
      return "showGit";
    }

    if (key === "f12") {
      return "showTerminal";
    }
  }

  return null;
}
