import { useEffect, useMemo, useState } from "react";
import { candidateToCurrentClassMethod } from "@/components/layout/indexed-completion-model";
import { collectCurrentClassMethods, type CurrentClassMethod } from "@/features/workspace/current-class-methods";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import { normalizePath } from "@/features/workspace/workspace-store";

const FILE_SYMBOL_PAGE_SIZE = 80;

export type UseCurrentFileSymbolsControllerOptions = {
  workspaceApi: WorkspaceApi;
  rootPath?: string | null;
  activePath: string | null;
  editorLine: number;
  getActiveContent: () => string;
  onBeforeShow: () => void;
  rememberCurrentLocation: () => void;
  setSelectionTarget: (target: { line: number; column: number; nonce: number } | null) => void;
  bumpEditorFocusToken: () => void;
  focusEditorSoon: () => void;
  onStatusChange: (message: string) => void;
};

export function useCurrentFileSymbolsController({
  workspaceApi,
  rootPath,
  activePath,
  editorLine,
  getActiveContent,
  onBeforeShow,
  rememberCurrentLocation,
  setSelectionTarget,
  bumpEditorFocusToken,
  focusEditorSoon,
  onStatusChange,
}: UseCurrentFileSymbolsControllerOptions) {
  const [currentMethodsVisible, setCurrentMethodsVisible] = useState(false);
  const [currentMethodsQuery, setCurrentMethodsQuery] = useState("");
  const [currentMethodsSelectedIndex, setCurrentMethodsSelectedIndex] = useState(0);
  const [indexedCurrentMethods, setIndexedCurrentMethods] = useState<{ path: string; methods: CurrentClassMethod[] } | null>(null);
  const [currentMethodsNextCursor, setCurrentMethodsNextCursor] = useState<number | null>(null);
  const [currentMethodsLoading, setCurrentMethodsLoading] = useState(false);

  function showCurrentClassMethods() {
    if (!activePath) {
      onStatusChange("Current class methods unavailable: no active file");
      return;
    }
    onBeforeShow();
    setCurrentMethodsQuery("");
    setCurrentMethodsSelectedIndex(0);
    setIndexedCurrentMethods(null);
    setCurrentMethodsNextCursor(null);
    setCurrentMethodsVisible(true);
    onStatusChange("File Structure");
    void loadIndexedCurrentClassMethods(activePath);
  }

  async function loadIndexedCurrentClassMethods(path: string) {
    await loadIndexedCurrentClassMethodPage(path, null, false);
  }

  async function loadIndexedCurrentClassMethodPage(path: string, cursor: number | null, append: boolean) {
    if (!rootPath || (!workspaceApi.queryWorkspaceFileSymbolsWithReadiness && !workspaceApi.queryWorkspaceFileSymbols)) {
      return;
    }
    if (currentMethodsLoading) return;
    setCurrentMethodsLoading(true);
    try {
      const envelope = workspaceApi.queryWorkspaceFileSymbolsWithReadiness
        ? await workspaceApi.queryWorkspaceFileSymbolsWithReadiness(rootPath, path, "", FILE_SYMBOL_PAGE_SIZE, cursor)
        : { items: await workspaceApi.queryWorkspaceFileSymbols!(rootPath, path, "", 200), nextCursor: null };
      const methods = fileSymbolMethods(envelope.items);
      setIndexedCurrentMethods((current) => ({
        path,
        methods: append && current && normalizePath(current.path) === normalizePath(path)
          ? [...current.methods, ...methods]
          : methods,
      }));
      setCurrentMethodsNextCursor(envelope.nextCursor ?? null);
    } catch {
      setIndexedCurrentMethods(null);
      setCurrentMethodsNextCursor(null);
    } finally {
      setCurrentMethodsLoading(false);
    }
  }

  function closeCurrentClassMethods() {
    hideCurrentClassMethods();
    focusEditorSoon();
  }

  function hideCurrentClassMethods() {
    setCurrentMethodsVisible(false);
    setCurrentMethodsQuery("");
    setCurrentMethodsSelectedIndex(0);
    setCurrentMethodsNextCursor(null);
  }

  function openCurrentClassMethod(method: CurrentClassMethod) {
    rememberCurrentLocation();
    setSelectionTarget({ line: method.line, column: method.column, nonce: Date.now() });
    bumpEditorFocusToken();
    setCurrentMethodsVisible(false);
    onStatusChange(`${method.kind === "member" ? "Member" : "Method"}: ${method.signature}`);
    focusEditorSoon();
  }

  const localCurrentClassMethods = useMemo(() => (
    collectCurrentClassMethods(getActiveContent(), editorLine)
  ), [editorLine, getActiveContent]);

  const currentClassMethods = useMemo(() => {
    const indexed = indexedCurrentMethods;
    if (!activePath || !indexed || normalizePath(indexed.path) !== normalizePath(activePath)) {
      return localCurrentClassMethods;
    }
    if (indexed.methods.length === 0) {
      return localCurrentClassMethods;
    }
    const localByName = new Map(localCurrentClassMethods.map((method) => [method.name, method]));
    const scoped = indexed.methods
      .filter((method) => localByName.size === 0 || localByName.has(method.name))
      .map((method) => ({ ...method, signature: localByName.get(method.name)?.signature ?? method.signature }));
    return scoped.length > 0 ? scoped : localCurrentClassMethods;
  }, [activePath, indexedCurrentMethods, localCurrentClassMethods]);

  const visibleCurrentClassMethods = useMemo(() => {
    const query = currentMethodsQuery.trim().toLowerCase();
    return currentClassMethods.filter((method) => (
      !query || method.name.toLowerCase().includes(query) || method.signature.toLowerCase().includes(query)
    ));
  }, [currentClassMethods, currentMethodsQuery]);

  useEffect(() => {
    setCurrentMethodsSelectedIndex((current) => {
      const resultCount = visibleCurrentClassMethods.length;
      if (resultCount === 0) return 0;
      return Math.min(current, resultCount - 1);
    });
  }, [visibleCurrentClassMethods.length]);

  useEffect(() => {
    if (!currentMethodsVisible || !activePath || currentMethodsLoading || currentMethodsNextCursor == null) return;
    if (currentMethodsSelectedIndex < visibleCurrentClassMethods.length - 1) return;
    void loadIndexedCurrentClassMethodPage(activePath, currentMethodsNextCursor, true);
  }, [activePath, currentMethodsLoading, currentMethodsNextCursor, currentMethodsSelectedIndex, currentMethodsVisible, visibleCurrentClassMethods.length]);

  return {
    currentMethodsVisible,
    currentMethodsQuery,
    setCurrentMethodsQuery,
    currentMethodsSelectedIndex,
    setCurrentMethodsSelectedIndex,
    visibleCurrentClassMethods,
    showCurrentClassMethods,
    hideCurrentClassMethods,
    closeCurrentClassMethods,
    openCurrentClassMethod,
  };
}

function fileSymbolMethods(candidates: SearchCandidate[]) {
  return candidates
    .filter((candidate) => candidate.source === "symbol" && ["method", "function", "field", "property", "variable"].includes(candidate.kind ?? ""))
    .map(candidateToCurrentClassMethod);
}
