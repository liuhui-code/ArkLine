import { useRef, type MutableRefObject } from "react";
import { parseGoToLineQuery } from "@/components/layout/app-shell-helpers";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { getPathBasename } from "@/features/workspace/workspace-store";

type DocumentStoreRef = MutableRefObject<{
  getDocument(path: string): { currentContent: string } | undefined;
  openDocument(path: string, content: string): void;
  updateDocument(path: string, content: string): void;
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
  syncEditor: (path: string | null) => void;
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
  syncEditor,
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
  const openFileRequestRef = useRef(0);

  async function openFile(path: string) {
    const requestId = openFileRequestRef.current + 1;
    openFileRequestRef.current = requestId;
    const content = await workspaceApi.openFile(path);
    if (openFileRequestRef.current !== requestId) {
      return;
    }
    if (!documentsRef.current.getDocument(path)) {
      documentsRef.current.openDocument(path, content);
    }
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
    onStatusChange(`Opened ${getPathBasename(path)}`);
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
    documentsRef.current.updateDocument(activePath, content);
    syncTabs();
    syncEditor(activePath);
    onStatusChange("Modified");
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
