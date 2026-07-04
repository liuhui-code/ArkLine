import type { RefObject } from "react";
import type { OverlayKey } from "@/components/layout/shell-state";

export type UseShellTransientActionsOptions = {
  closeTransientGitUi: () => boolean;
  codeActionsVisible: boolean;
  closeCodeActionsPalette: () => void;
  workspaceEditPreviewOpen: boolean;
  closeWorkspaceEditPreview: () => void;
  activeOverlay: OverlayKey;
  setActiveOverlay: (overlay: OverlayKey) => void;
  currentMethodsVisible: boolean;
  closeCurrentClassMethods: () => void;
  projectPickerVisible: boolean;
  closeProjectPicker: () => void;
  projectDecisionVisible: boolean;
  cancelPendingProjectOpen: () => void;
  settingsVisible: boolean;
  closeSettings: () => void;
  bottomContentVisible: boolean;
  bottomToolWindowRef: RefObject<HTMLElement | null>;
  hideBottomToolWindow: () => void;
  filesVisible: boolean;
  filesPaneRef: RefObject<HTMLElement | null>;
  setFilesVisible: (visible: boolean) => void;
  setBottomContentVisible: (visible: boolean) => void;
  focusEditor: () => void;
  onStatusChange: (message: string) => void;
};

export function useShellTransientActions({
  closeTransientGitUi,
  codeActionsVisible,
  closeCodeActionsPalette,
  workspaceEditPreviewOpen,
  closeWorkspaceEditPreview,
  activeOverlay,
  setActiveOverlay,
  currentMethodsVisible,
  closeCurrentClassMethods,
  projectPickerVisible,
  closeProjectPicker,
  projectDecisionVisible,
  cancelPendingProjectOpen,
  settingsVisible,
  closeSettings,
  bottomContentVisible,
  bottomToolWindowRef,
  hideBottomToolWindow,
  filesVisible,
  filesPaneRef,
  setFilesVisible,
  setBottomContentVisible,
  focusEditor,
  onStatusChange,
}: UseShellTransientActionsOptions) {
  function closeTransientUi() {
    if (closeTransientGitUi()) {
      return true;
    }
    if (codeActionsVisible) {
      closeCodeActionsPalette();
      return true;
    }
    if (workspaceEditPreviewOpen) {
      closeWorkspaceEditPreview();
      return true;
    }
    if (activeOverlay !== "none") {
      setActiveOverlay("none");
      focusEditor();
      return true;
    }
    if (currentMethodsVisible) {
      closeCurrentClassMethods();
      return true;
    }
    if (projectPickerVisible) {
      closeProjectPicker();
      focusEditor();
      return true;
    }
    if (projectDecisionVisible) {
      cancelPendingProjectOpen();
      focusEditor();
      return true;
    }
    if (settingsVisible) {
      closeSettings();
      focusEditor();
      return true;
    }
    return false;
  }

  function hideActiveToolWindow() {
    if (closeTransientUi()) {
      return;
    }
    const activeElement = document.activeElement;
    const focusTargets = [
      [bottomContentVisible, bottomToolWindowRef.current, hideBottomToolWindow],
      [filesVisible, filesPaneRef.current, () => setFilesVisible(false)],
    ] as const;
    const focusedTarget = activeElement instanceof Node
      ? focusTargets.find(([, container]) => container?.contains(activeElement))
      : null;
    if (focusedTarget) {
      focusedTarget[2]();
      focusEditor();
      return;
    }
    const visibleTarget = focusTargets.find(([visible]) => visible);
    if (visibleTarget) {
      visibleTarget[2]();
      focusEditor();
    }
  }

  function enterEditorOnlyMode() {
    setActiveOverlay("none");
    closeSettings();
    setFilesVisible(false);
    setBottomContentVisible(false);
    onStatusChange("Editor Only");
    focusEditor();
  }

  return {
    closeTransientUi,
    hideActiveToolWindow,
    enterEditorOnlyMode,
  };
}
