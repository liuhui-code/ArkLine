import { useEffect, useMemo, useState } from "react";
import { candidateToCurrentClassMethod } from "@/components/layout/indexed-completion-model";
import { collectCurrentClassMethods, type CurrentClassMethod } from "@/features/workspace/current-class-methods";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { normalizePath } from "@/features/workspace/workspace-store";

export type UseCurrentFileSymbolsControllerOptions = {
  workspaceApi: WorkspaceApi;
  rootPath?: string | null;
  activePath: string | null;
  editorContent: string;
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
  editorContent,
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

  function showCurrentClassMethods() {
    if (!activePath) {
      onStatusChange("Current class methods unavailable: no active file");
      return;
    }
    onBeforeShow();
    setCurrentMethodsQuery("");
    setCurrentMethodsSelectedIndex(0);
    setIndexedCurrentMethods(null);
    setCurrentMethodsVisible(true);
    onStatusChange("File Structure");
    void loadIndexedCurrentClassMethods(activePath);
  }

  async function loadIndexedCurrentClassMethods(path: string) {
    if (!rootPath || !workspaceApi.queryWorkspaceFileSymbols) {
      return;
    }
    try {
      const candidates = await workspaceApi.queryWorkspaceFileSymbols(rootPath, path, "", 200);
      const methods = candidates
        .filter((candidate) => candidate.source === "symbol" && ["method", "function", "field", "property", "variable"].includes(candidate.kind ?? ""))
        .map(candidateToCurrentClassMethod);
      setIndexedCurrentMethods({ path, methods });
    } catch {
      setIndexedCurrentMethods(null);
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
    collectCurrentClassMethods(getActiveContent() || editorContent, editorLine)
  ), [editorContent, editorLine, getActiveContent]);

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
