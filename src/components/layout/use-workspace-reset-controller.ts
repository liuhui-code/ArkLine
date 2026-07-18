import { useCallback } from "react";

export type WorkspaceResetControllerActions = {
  resetTabs: () => void;
  resetProjectSelection: () => void;
  resetActiveDocument: () => void;
  resetQuickOpen: () => void;
  resetProjectPicker: () => void;
  resetOverlay: () => void;
  resetProblems: () => void;
  resetDiff: () => void;
  resetCodeActions: () => void;
  resetWorkspaceEdit: () => void;
  resetCompletion: () => void;
  resetUsageSearch: () => void;
  resetEditorState: () => void;
  resetDocumentCache: () => void;
  showBottomContent: () => void;
  onStatusChange: (message: string) => void;
};

export function useWorkspaceResetController(actions: WorkspaceResetControllerActions) {
  const resetWorkspaceUi = useCallback((rootName: string) => {
    actions.resetTabs();
    actions.resetProjectSelection();
    actions.resetActiveDocument();
    actions.resetQuickOpen();
    actions.resetProjectPicker();
    actions.resetOverlay();
    actions.resetProblems();
    actions.resetDiff();
    actions.resetCodeActions();
    actions.resetWorkspaceEdit();
    actions.resetCompletion();
    actions.resetUsageSearch();
    actions.resetEditorState();
    actions.resetDocumentCache();
    actions.showBottomContent();
    actions.onStatusChange(`Workspace ready: ${rootName}`);
  }, [actions]);

  return { resetWorkspaceUi };
}
