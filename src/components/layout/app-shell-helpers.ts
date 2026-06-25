import { buildCommandPaletteItems } from "@/components/layout/search-overlay-model";
import { getShellCommandShortcut } from "@/components/layout/shell-keymap";

export function parseGoToLineQuery(query: string) {
  const match = query.trim().match(/^(\d+)(?::(\d+))?$/);
  if (!match) {
    return null;
  }

  return {
    line: Number.parseInt(match[1] ?? "1", 10),
    column: Number.parseInt(match[2] ?? "1", 10),
  };
}

export function extractCompletionPrefix(content: string, line: number, column: number) {
  const lines = content.split(/\r?\n/);
  const lineText = lines[line - 1] ?? "";
  const safeColumn = Math.max(column - 1, 0);
  const prefix = lineText.slice(0, safeColumn).match(/[@A-Za-z0-9_$]+$/);
  return prefix?.[0] ?? "";
}

type CommandPaletteAction = {
  openProject: () => void | Promise<void>;
  openDemoWorkspace: () => void;
  openRecentProjects: () => void;
  openGoToLine: () => void;
  goToDefinition: () => void | Promise<void>;
  findUsages: () => void | Promise<void>;
  showCurrentClassMethods: () => void;
  showCodeActions: () => void | Promise<void>;
  renameSymbol: () => void | Promise<void>;
  generateCode: () => void | Promise<void>;
  refactorThis: () => void | Promise<void>;
  openCompletion: () => void | Promise<void>;
  runLint: () => void;
  formatActiveDocument: () => void;
  loadDiff: () => void;
  openSettings: () => void;
  toggleGitBlame: () => void;
  refreshGitBlame: () => void;
  showCurrentLineBlame: () => void;
  closeGitBlame: () => void;
};

export function buildAppShellCommandPaletteItems(query: string, actions: CommandPaletteAction) {
  return buildCommandPaletteItems(query, [
    { id: "open-project", label: "Open Project", action: actions.openProject },
    { id: "open-demo", label: "Open Demo Workspace", action: actions.openDemoWorkspace },
    { id: "recent-projects", label: "Recent Projects", action: actions.openRecentProjects },
    { id: "go-to-line", label: "Go to Line...", action: actions.openGoToLine },
    { id: "go-to-definition", label: "Go to Definition", shortcut: getShellCommandShortcut("goToDefinition"), action: actions.goToDefinition },
    { id: "find-usages", label: "Find Usages", shortcut: getShellCommandShortcut("findUsages"), action: actions.findUsages },
    { id: "current-class-methods", label: "Show Current Class Methods", shortcut: getShellCommandShortcut("showCurrentClassMethods"), action: actions.showCurrentClassMethods },
    { id: "show-code-actions", label: "Show Code Actions", shortcut: getShellCommandShortcut("showCodeActions"), action: actions.showCodeActions },
    { id: "rename-symbol", label: "Rename Symbol", shortcut: getShellCommandShortcut("renameSymbol"), action: actions.renameSymbol },
    { id: "generate-code", label: "Generate Code", shortcut: getShellCommandShortcut("generateCode"), action: actions.generateCode },
    { id: "refactor-this", label: "Refactor This", shortcut: getShellCommandShortcut("refactorThis"), action: actions.refactorThis },
    { id: "completion", label: "Code Completion", shortcut: getShellCommandShortcut("openCompletion"), action: actions.openCompletion },
    { id: "run-validation", label: "Run Lint", action: actions.runLint },
    { id: "format-active-document", label: "Format Active Document", action: actions.formatActiveDocument },
    { id: "load-diff", label: "Load Diff", action: actions.loadDiff },
    { id: "open-settings", label: "Open Settings", action: actions.openSettings },
    { id: "toggle-git-blame", label: "Toggle Git Blame", action: actions.toggleGitBlame },
    { id: "refresh-git-blame", label: "Refresh Git Blame", action: actions.refreshGitBlame },
    { id: "show-current-line-git-blame", label: "Show Current Line Git Blame", action: actions.showCurrentLineBlame },
    { id: "close-git-blame", label: "Close Git Blame", action: actions.closeGitBlame },
  ]);
}
