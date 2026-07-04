import { useMemo } from "react";
import { buildAppShellCommandPaletteItems } from "@/components/layout/app-shell-helpers";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { ShellCommand } from "@/components/layout/shell-keymap";
import { useShellHotkeys } from "@/components/layout/useShellHotkeys";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";

type AppShellCommandActions = {
  closeTransientUi: () => void;
  closeActiveFile: () => void;
  hideActiveToolWindow: () => void;
  toggleEditorOnly: () => void;
  navigateBack: () => void | Promise<void>;
  openQuickOpen: () => void;
  openSearchEverywhere: () => void;
  openFindInFiles: () => void;
  openReplaceInFiles: () => void;
  openRecentFiles: () => void;
  openCommandPalette: () => void;
  openCompletion: () => void | Promise<void>;
  showProject: () => void;
  showProblems: () => void;
  showGit: () => void;
  showTerminal: () => void;
  goToDefinition: () => void | Promise<void>;
  findUsages: () => void | Promise<void>;
  showCurrentClassMethods: () => void;
  showCodeActions: () => void | Promise<void>;
  renameSymbol: () => void | Promise<void>;
  generateCode: () => void | Promise<void>;
  refactorThis: () => void | Promise<void>;
  save: () => void | Promise<void>;
  openProject: () => void | Promise<void>;
  openDemoWorkspace: () => void;
  openRecentProjects: () => void;
  newFile: () => void;
  newDirectory: () => void;
  openGoToLine: () => void;
  runLint: () => void;
  formatActiveDocument: () => void;
  loadDiff: () => void;
  openSettings: () => void;
  toggleGitBlame: () => void;
  refreshGitBlame: () => void;
  showCurrentLineBlame: () => void;
  closeGitBlame: () => void;
};

export type UseAppShellCommandsOptions = {
  quickOpenQuery: string;
  activeOverlay: OverlayKey;
  workspaceEditPreviewOpen: boolean;
  codeActionsVisible: boolean;
  currentMethodsVisible: boolean;
  settingsVisible: boolean;
  settingsApplying: boolean;
  actions: AppShellCommandActions;
};

export function useAppShellCommands({
  quickOpenQuery,
  activeOverlay,
  workspaceEditPreviewOpen,
  codeActionsVisible,
  currentMethodsVisible,
  settingsVisible,
  settingsApplying,
  actions,
}: UseAppShellCommandsOptions): CommandPaletteItem[] {
  const shellHotkeyContext = useMemo(() => ({
    completionOpen: activeOverlay === "completion",
    overlayOpen: workspaceEditPreviewOpen
      || codeActionsVisible
      || currentMethodsVisible
      || (activeOverlay !== "none" && activeOverlay !== "completion"),
    settingsOpen: settingsVisible,
    settingsApplying,
  }), [activeOverlay, codeActionsVisible, currentMethodsVisible, settingsApplying, settingsVisible, workspaceEditPreviewOpen]);

  useShellHotkeys({
    context: shellHotkeyContext,
    onCommand(command: ShellCommand) {
      const handlers: Partial<Record<ShellCommand, () => void | Promise<void>>> = {
        closeTransientUi: actions.closeTransientUi,
        closeActiveFile: actions.closeActiveFile,
        hideActiveToolWindow: actions.hideActiveToolWindow,
        toggleEditorOnly: actions.toggleEditorOnly,
        navigateBack: actions.navigateBack,
        openQuickOpen: actions.openQuickOpen,
        openSearchEverywhere: actions.openSearchEverywhere,
        openFindInFiles: actions.openFindInFiles,
        openReplaceInFiles: actions.openReplaceInFiles,
        openRecentFiles: actions.openRecentFiles,
        openCommandPalette: actions.openCommandPalette,
        openCompletion: actions.openCompletion,
        showProject: actions.showProject,
        showProblems: actions.showProblems,
        showGit: actions.showGit,
        showTerminal: actions.showTerminal,
        goToDefinition: actions.goToDefinition,
        findUsages: actions.findUsages,
        showCurrentClassMethods: actions.showCurrentClassMethods,
        showCodeActions: actions.showCodeActions,
        renameSymbol: actions.renameSymbol,
        generateCode: actions.generateCode,
        refactorThis: actions.refactorThis,
        save: actions.save,
      };
      void handlers[command]?.();
    },
  });

  return buildAppShellCommandPaletteItems(quickOpenQuery, {
    openProject: actions.openProject,
    openDemoWorkspace: actions.openDemoWorkspace,
    openRecentProjects: actions.openRecentProjects,
    newFile: actions.newFile,
    newDirectory: actions.newDirectory,
    openFindInFiles: actions.openFindInFiles,
    openReplaceInFiles: actions.openReplaceInFiles,
    openGoToLine: actions.openGoToLine,
    goToDefinition: actions.goToDefinition,
    findUsages: actions.findUsages,
    showCurrentClassMethods: actions.showCurrentClassMethods,
    showCodeActions: actions.showCodeActions,
    renameSymbol: actions.renameSymbol,
    generateCode: actions.generateCode,
    refactorThis: actions.refactorThis,
    openCompletion: actions.openCompletion,
    runLint: actions.runLint,
    formatActiveDocument: actions.formatActiveDocument,
    loadDiff: actions.loadDiff,
    openSettings: actions.openSettings,
    toggleGitBlame: actions.toggleGitBlame,
    refreshGitBlame: actions.refreshGitBlame,
    showCurrentLineBlame: actions.showCurrentLineBlame,
    closeGitBlame: actions.closeGitBlame,
  });
}
