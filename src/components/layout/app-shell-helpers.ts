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
  const prefix = getLineTextBeforeCursor(content, line, column).match(/[@A-Za-z0-9_$]+$/);
  return prefix?.[0] ?? "";
}

export function getLineTextBeforeCursor(content: string, line: number, column: number) {
  const bounds = findLineBounds(content, line);
  const safeColumn = Math.max(column - 1, 0);
  return content.slice(bounds.start, Math.min(bounds.start + safeColumn, bounds.end));
}

function findLineBounds(content: string, line: number) {
  const targetLine = Math.max(1, line);
  let currentLine = 1;
  let lineStart = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) !== 10) {
      continue;
    }

    if (currentLine === targetLine) {
      return { start: lineStart, end: trimCarriageReturn(content, index) };
    }

    currentLine += 1;
    lineStart = index + 1;
    if (currentLine > targetLine) {
      break;
    }
  }

  if (currentLine === targetLine) {
    return { start: lineStart, end: content.length };
  }
  return { start: content.length, end: content.length };
}

function trimCarriageReturn(content: string, lineEnd: number) {
  return lineEnd > 0 && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
}

type CommandPaletteAction = {
  openProject: () => void | Promise<void>;
  openDemoWorkspace: () => void;
  openRecentProjects: () => void;
  newFile: () => void;
  newDirectory: () => void;
  openFindInFiles: () => void;
  openReplaceInFiles: () => void;
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
    { id: "new-file", label: "New File", action: actions.newFile },
    { id: "new-directory", label: "New Directory", action: actions.newDirectory },
    { id: "find-in-files", label: "Find in Files", shortcut: getShellCommandShortcut("openFindInFiles"), action: actions.openFindInFiles },
    { id: "replace-in-files", label: "Replace in Files", shortcut: getShellCommandShortcut("openReplaceInFiles"), action: actions.openReplaceInFiles },
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
