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
import { beginInteractionTrace } from "@/features/performance/interaction-trace-store";

type DocumentStoreRef = MutableRefObject<{
  getDocument(path: string): { currentContent: string } | undefined;
  getDocumentText?(path: string): Text | undefined;
  openDocument(path: string, content: string): void;
  openDocumentText?(path: string, content: string, document: Text): void;
  updateDocument(path: string, content: string): { dirtyChanged: boolean };
  applyEditorDocument?(path: string, document: Text): { dirtyChanged: boolean };
}>;

type TabsStoreRef = MutableRefObject<{
  openTab(path: string, disposition?: "pinned" | "preview"): void;
  pinTab?(path: string): void;
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
  closeCompletion: () => void;
  resetCodeActionSession: () => void;
  setEditorSelection: (selection: { line: number; column: number; selectedText?: string }) => void;
  setInsertTextTarget: (target: { text: string; replaceBefore?: number; nonce: number } | null) => void;
  setSelectionTarget: (target: { line: number; column: number; nonce: number } | null) => void;
  setActiveOverlay: (overlay: OverlayKey) => void;
  setQuickOpenQuery: (query: string) => void;
  bumpEditorFocusToken: () => void;
  rememberCurrentLocation: () => void;
  focusEditorSoon: () => void;
  onStatusChange: (message: string) => void;
  documentLoadCoordinator?: DocumentLoadCoordinator;
  scheduleActivation?: (request: DocumentActivationRequest) => Promise<void>;
  prepareDocumentText?: (content: string) => Promise<Text>;
};

export type RestoreFileResult = {
  ok: boolean;
  errorMessage?: string;
};

export type OpenFileInteractionContext = {
  parentInteractionId?: string;
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
  closeCompletion,
  resetCodeActionSession,
  setEditorSelection,
  setInsertTextTarget,
  setSelectionTarget,
  setActiveOverlay,
  setQuickOpenQuery,
  bumpEditorFocusToken,
  rememberCurrentLocation,
  focusEditorSoon,
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
  async function openFile(
    path: string,
    interaction: OpenFileInteractionContext = {},
  ): Promise<RestoreFileResult> {
    return openFileInternal(path, "preview", interaction);
  }

  async function restoreFile(path: string): Promise<RestoreFileResult> {
    return openFileInternal(path, "pinned");
  }

  function cancelPendingOpen() {
    runtimeRef.current.navigation.cancel();
  }

  async function openFileInternal(
    path: string,
    disposition: "pinned" | "preview",
    interaction: OpenFileInteractionContext = {},
  ): Promise<RestoreFileResult> {
    const title = getPathBasename(path);
    const transaction = runtimeRef.current.navigation.start(path);
    const trace = beginInteractionTrace("openFile", title, transaction.id, {
      parentId: interaction.parentInteractionId,
      attributes: { path, disposition },
    });
    if (documentsRef.current.getDocument(path)) {
      if (runtimeRef.current.navigation.isCurrent(transaction.id)) {
        const activationPhase = trace.startPhase("activateCachedDocument");
        activateLoadedDocument(path, disposition);
        activationPhase.finish();
        runtimeRef.current.navigation.finish(transaction.id);
        onStatusChange(`Opened ${title}`);
        trace.finish();
      } else {
        trace.finish("superseded");
      }
      return { ok: true };
    }
    onStatusChange(`Opening ${title}...`);
    const cached = documentLoad.peek(path) !== undefined;
    let content: string;
    const loadPhase = trace.startPhase(cached ? "loadCachedFile" : "loadFile");
    try {
      content = await documentLoad.load(
        path,
        (filePath) => workspaceApi.openFile(filePath, { interactionId: trace.id }),
      );
      loadPhase.finish();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loadPhase.finish("error", message);
      const current = runtimeRef.current.navigation.isCurrent(transaction.id);
      if (current) {
        runtimeRef.current.navigation.finish(transaction.id);
        onStatusChange(`Open failed ${title}: ${message}`);
      }
      trace.finish(current ? "error" : "superseded");
      return { ok: false, errorMessage: message };
    }
    if (!runtimeRef.current.navigation.isCurrent(transaction.id)) {
      trace.finish("superseded");
      return { ok: false, errorMessage: "superseded" };
    }
    const preparePhase = trace.startPhase("prepareDocument");
    try {
      await scheduleActivation({ cached, contentLength: content.length });
      if (!runtimeRef.current.navigation.isCurrent(transaction.id)) {
        preparePhase.finish("superseded");
        trace.finish("superseded");
        return { ok: false, errorMessage: "superseded" };
      }
      const document = await prepareDocumentText(content);
      if (!runtimeRef.current.navigation.isCurrent(transaction.id)) {
        preparePhase.finish("superseded");
        trace.finish("superseded");
        return { ok: false, errorMessage: "superseded" };
      }
      if (documentsRef.current.openDocumentText) {
        documentsRef.current.openDocumentText(path, content, document);
      } else {
        documentsRef.current.openDocument(path, content);
      }
      preparePhase.finish();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      preparePhase.finish("error", message);
      const current = runtimeRef.current.navigation.isCurrent(transaction.id);
      if (current) {
        runtimeRef.current.navigation.finish(transaction.id);
        onStatusChange(`Open failed ${title}: ${message}`);
      }
      trace.finish(current ? "error" : "superseded");
      return { ok: false, errorMessage: message };
    }
    const activationPhase = trace.startPhase("activateEditor");
    activateLoadedDocument(path, disposition);
    activationPhase.finish();
    runtimeRef.current.navigation.finish(transaction.id);
    onStatusChange(`Opened ${title}`);
    trace.finish();
    return { ok: true };
  }

  function activateLoadedDocument(path: string, disposition: "pinned" | "preview") {
    tabsRef.current.openTab(path, disposition);
    syncTabs();
    setActiveDocument(path);
    includeVisibleWorkspaceFile(path);
    closeCompletion();
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
      tabsRef.current.pinTab?.(activePath);
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
      tabsRef.current.pinTab?.(activePath);
      syncTabs();
      onStatusChange("Modified");
    }
  }

  function handleEditorSelectionChange(selection: { line: number; column: number; selectedText?: string }) {
    setEditorSelection(selection);
  }

  return {
    openFile,
    restoreFile,
    cancelPendingOpen,
    submitGoToLine,
    handleEditorChange,
    handleEditorDocumentChange,
    handleEditorSelectionChange,
  };
}
