import { useRef, type MutableRefObject } from "react";
import { parseGoToLineQuery } from "@/components/layout/app-shell-helpers";
import type { OverlayKey } from "@/components/layout/shell-state";
import {
  createDocumentLoadCoordinator,
  type DocumentLoadCoordinator,
} from "@/features/documents/document-load-coordinator";
import {
  scheduleDocumentActivation,
  type DocumentActivationRequest,
} from "@/features/documents/document-activation-scheduler";
import { buildDocumentText } from "@/features/documents/document-text-builder";
import { createNavigationTransactionRuntime } from "@/features/navigation/navigation-transaction-runtime";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { getPathBasename } from "@/features/workspace/workspace-store";
import type { Text } from "@codemirror/state";

type DocumentStoreRef = MutableRefObject<{
  getDocument(path: string): { currentContent: string } | undefined;
  openDocument(path: string, content: string): void;
  openDocumentText?(path: string, content: string, document: Text): void;
  updateDocument(path: string, content: string): { dirtyChanged: boolean };
  applyEditorDocument?(path: string, document: Text): { dirtyChanged: boolean };
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
  setEditorSelection: (selection: { line: number; column: number; selectedText?: string }) => void;
  setInsertTextTarget: (target: { text: string; replaceBefore?: number; nonce: number } | null) => void;
  setSelectionTarget: (target: { line: number; column: number; nonce: number } | null) => void;
  setActiveOverlay: (overlay: OverlayKey) => void;
  setQuickOpenQuery: (query: string) => void;
  bumpEditorFocusToken: () => void;
  rememberCurrentLocation: () => void;
  focusEditorSoon: () => void;
  syncCompletionForEditorSelection: (selection: { line: number; column: number; selectedText?: string }) => void;
  onStatusChange: (message: string) => void;
  documentLoadCoordinator?: DocumentLoadCoordinator;
  scheduleActivation?: (request: DocumentActivationRequest) => Promise<void>;
  prepareDocumentText?: (content: string) => Promise<Text>;
};

export type RestoreFileResult = {
  ok: boolean;
  errorMessage?: string;
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
  setInsertTextTarget,
  setSelectionTarget,
  setActiveOverlay,
  setQuickOpenQuery,
  bumpEditorFocusToken,
  rememberCurrentLocation,
  focusEditorSoon,
  syncCompletionForEditorSelection,
  onStatusChange,
  documentLoadCoordinator,
  scheduleActivation = scheduleDocumentActivation,
  prepareDocumentText = buildDocumentText,
}: UseEditorSurfaceControllerOptions) {
  const fallbackDocumentLoadRef = useRef(createDocumentLoadCoordinator());
  const runtimeRef = useRef({
    navigation: createNavigationTransactionRuntime(),
  });
  const documentLoad = documentLoadCoordinator ?? fallbackDocumentLoadRef.current;

  async function openFile(path: string) {
    await openFileInternal(path);
  }

  async function restoreFile(path: string): Promise<RestoreFileResult> {
    return openFileInternal(path);
  }

  async function openFileInternal(path: string): Promise<RestoreFileResult> {
    const title = getPathBasename(path);
    if (documentsRef.current.getDocument(path)) {
      activateLoadedDocument(path);
      onStatusChange(`Opened ${title}`);
      return { ok: true };
    }
    const transaction = runtimeRef.current.navigation.start(path);
    onStatusChange(`Opening ${title}...`);
    const cached = documentLoad.peek(path) !== undefined;
    let content: string;
    try {
      content = await documentLoad.load(path, workspaceApi.openFile);
    } catch (error) {
      if (runtimeRef.current.navigation.isCurrent(transaction.id)) {
        runtimeRef.current.navigation.finish(transaction.id);
        onStatusChange(`Open failed ${title}`);
      }
      return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
    }
    if (!runtimeRef.current.navigation.isCurrent(transaction.id)) {
      return { ok: false, errorMessage: "superseded" };
    }
    await scheduleActivation({ cached, contentLength: content.length });
    if (!runtimeRef.current.navigation.isCurrent(transaction.id)) {
      return { ok: false, errorMessage: "superseded" };
    }
    const document = await prepareDocumentText(content);
    if (!runtimeRef.current.navigation.isCurrent(transaction.id)) {
      return { ok: false, errorMessage: "superseded" };
    }
    if (documentsRef.current.openDocumentText) {
      documentsRef.current.openDocumentText(path, content, document);
    } else {
      documentsRef.current.openDocument(path, content);
    }
    activateLoadedDocument(path);
    runtimeRef.current.navigation.finish(transaction.id);
    onStatusChange(`Opened ${title}`);
    return { ok: true };
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

  function handleEditorDocumentChange(document: Text) {
    if (!activePath) {
      return;
    }
    const result = documentsRef.current.applyEditorDocument?.(activePath, document)
      ?? documentsRef.current.updateDocument(activePath, document.toString());
    if (result.dirtyChanged) {
      syncTabs();
      onStatusChange("Modified");
    }
  }

  function handleEditorSelectionChange(selection: { line: number; column: number; selectedText?: string }) {
    setEditorSelection(selection);
    syncCompletionForEditorSelection(selection);
  }

  return {
    openFile,
    restoreFile,
    submitGoToLine,
    handleEditorChange,
    handleEditorDocumentChange,
    handleEditorSelectionChange,
  };
}
