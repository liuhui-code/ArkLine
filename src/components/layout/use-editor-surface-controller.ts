import { useRef, type MutableRefObject } from "react";
import { parseGoToLineQuery } from "@/components/layout/app-shell-helpers";
import type { OverlayKey } from "@/components/layout/shell-state";
import { createNavigationTransactionRuntime } from "@/features/navigation/navigation-transaction-runtime";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { getPathBasename } from "@/features/workspace/workspace-store";

type DocumentStoreRef = MutableRefObject<{
  getDocument(path: string): { currentContent: string } | undefined;
  openDocument(path: string, content: string): void;
  updateDocument(path: string, content: string): { dirtyChanged: boolean };
}>;

type TabsStoreRef = MutableRefObject<{
  openTab(path: string): void;
}>;

export type UseEditorSurfaceControllerOptions = {
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  quickOpenQuery: string;
  documentsRef: DocumentStoreRef;
  tabsRef: TabsStoreRef;
  syncTabs: () => void;
  setActiveDocument: (path: string | null) => void;
  includeVisibleWorkspaceFile: (path: string) => void;
  clearCompletionSession: () => void;
  resetCompletionAnchor: () => void;
  resetCodeActionSession: () => void;
  setEditorSelection: (selection: { line: number; column: number }) => void;
  setEditorSelectedText: (text: string) => void;
  setInsertTextTarget: (target: { text: string; replaceBefore?: number; nonce: number } | null) => void;
  setSelectionTarget: (target: { line: number; column: number; nonce: number } | null) => void;
  setActiveOverlay: (overlay: OverlayKey) => void;
  setQuickOpenQuery: (query: string) => void;
  bumpEditorFocusToken: () => void;
  rememberCurrentLocation: () => void;
  focusEditorSoon: () => void;
  syncCompletionForEditorSelection: (selection: { line: number; column: number; selectedText?: string }) => void;
  onStatusChange: (message: string) => void;
};

export function useEditorSurfaceController({
  workspaceApi,
  activePath,
  quickOpenQuery,
  documentsRef,
  tabsRef,
  syncTabs,
  setActiveDocument,
  includeVisibleWorkspaceFile,
  clearCompletionSession,
  resetCompletionAnchor,
  resetCodeActionSession,
  setEditorSelection,
  setEditorSelectedText,
  setInsertTextTarget,
  setSelectionTarget,
  setActiveOverlay,
  setQuickOpenQuery,
  bumpEditorFocusToken,
  rememberCurrentLocation,
  focusEditorSoon,
  syncCompletionForEditorSelection,
  onStatusChange,
}: UseEditorSurfaceControllerOptions) {
  const navigationRuntimeRef = useRef(createNavigationTransactionRuntime());

  async function openFile(path: string) {
    const title = getPathBasename(path);
    if (documentsRef.current.getDocument(path)) {
      activateLoadedDocument(path);
      onStatusChange(`Opened ${title}`);
      return;
    }
    const transaction = navigationRuntimeRef.current.start(path);
    onStatusChange(`Opening ${title}...`);
    let content: string;
    try {
      content = await workspaceApi.openFile(path);
    } catch {
      if (navigationRuntimeRef.current.isCurrent(transaction.id)) {
        navigationRuntimeRef.current.finish(transaction.id);
        onStatusChange(`Open failed ${title}`);
      }
      return;
    }
    if (!navigationRuntimeRef.current.isCurrent(transaction.id)) {
      return;
    }
    documentsRef.current.openDocument(path, content);
    activateLoadedDocument(path);
    navigationRuntimeRef.current.finish(transaction.id);
    onStatusChange(`Opened ${title}`);
  }

  function activateLoadedDocument(path: string) {
    tabsRef.current.openTab(path);
    syncTabs();
    setActiveDocument(path);
    includeVisibleWorkspaceFile(path);
    clearCompletionSession();
    resetCompletionAnchor();
    resetCodeActionSession();
    setEditorSelection({ line: 1, column: 1 });
    setInsertTextTarget(null);
    setSelectionTarget(null);
    setActiveOverlay("none");
    setQuickOpenQuery("");
    bumpEditorFocusToken();
  }

  function submitGoToLine() {
    if (!activePath) {
      return;
    }
    const nextTarget = parseGoToLineQuery(quickOpenQuery);
    if (!nextTarget) {
      onStatusChange("Go to Line requires line or line:column");
      return;
    }

    rememberCurrentLocation();
    setSelectionTarget({
      ...nextTarget,
      nonce: Date.now(),
    });
    bumpEditorFocusToken();
    setActiveOverlay("none");
    onStatusChange(`Line ${nextTarget.line}${nextTarget.column > 1 ? `:${nextTarget.column}` : ""}`);
    focusEditorSoon();
  }

  function handleEditorChange(content: string) {
    if (!activePath) {
      return;
    }
    const result = documentsRef.current.updateDocument(activePath, content);
    if (result.dirtyChanged) {
      syncTabs();
      onStatusChange("Modified");
    }
  }

  function handleEditorSelectionChange(selection: { line: number; column: number; selectedText?: string }) {
    setEditorSelection({ line: selection.line, column: selection.column });
    setEditorSelectedText(selection.selectedText ?? "");
    syncCompletionForEditorSelection(selection);
  }

  return {
    openFile,
    submitGoToLine,
    handleEditorChange,
    handleEditorSelectionChange,
  };
}
