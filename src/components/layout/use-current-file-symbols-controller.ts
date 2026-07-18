import { useEffect, useMemo, useRef, useState } from "react";
import { candidateToCurrentClassMethod } from "@/components/layout/indexed-completion-model";
import { collectCurrentClassMethods, type CurrentClassMethod } from "@/features/workspace/current-class-methods";
import { createLanguageSessionStore, languageRequestTimeout } from "@/features/language/language-session-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import { normalizePath } from "@/features/workspace/workspace-store";

const FILE_SYMBOL_PAGE_SIZE = 80;
const FILE_SYMBOL_TIMEOUT_MS = 2500;

export type UseCurrentFileSymbolsControllerOptions = {
  workspaceApi: WorkspaceApi;
  rootPath?: string | null;
  activePath: string | null;
  getEditorLine: () => number;
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
  getEditorLine,
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
  const languageSessionStore = useMemo(() => createLanguageSessionStore(), []);
  const currentMethodsRequestRef = useRef(0);

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
    setCurrentMethodsLoading(false);
    languageSessionStore.cancel("documentSymbols");
    setCurrentMethodsVisible(true);
    onStatusChange("File Structure");
    void loadIndexedCurrentClassMethods(activePath);
  }

  async function loadIndexedCurrentClassMethods(path: string) {
    await loadIndexedCurrentClassMethodPage(path, null, false);
  }

  async function loadIndexedCurrentClassMethodPage(path: string, cursor: number | null, append: boolean) {
    if (!rootPath || !workspaceApi.queryWorkspaceFileSymbolsWithReadiness) {
      return;
    }
    if (currentMethodsLoading) return;
    const languageSession = languageSessionStore.begin("documentSymbols", "documentSymbols:palette", FILE_SYMBOL_TIMEOUT_MS);
    currentMethodsRequestRef.current = languageSession.requestId;
    const isStaleRequest = () => currentMethodsRequestRef.current !== languageSession.requestId || !languageSessionStore.isCurrent(languageSession);
    setCurrentMethodsLoading(true);
    try {
      const envelope = await languageRequestTimeout(
        workspaceApi.queryWorkspaceFileSymbolsWithReadiness(rootPath, path, "", FILE_SYMBOL_PAGE_SIZE, cursor),
        languageSession.timeoutMs,
      );
      if (isStaleRequest()) return;
      const methods = fileSymbolMethods(envelope.items);
      setIndexedCurrentMethods((current) => ({
        path,
        methods: append && current && normalizePath(current.path) === normalizePath(path)
          ? [...current.methods, ...methods]
          : methods,
      }));
      setCurrentMethodsNextCursor(envelope.nextCursor ?? null);
      setCurrentMethodsLoading(false);
      languageSessionStore.complete(languageSession);
    } catch {
      if (isStaleRequest()) return;
      setIndexedCurrentMethods(null);
      setCurrentMethodsNextCursor(null);
      setCurrentMethodsLoading(false);
      languageSessionStore.complete(languageSession);
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
    setCurrentMethodsLoading(false);
    currentMethodsRequestRef.current += 1;
    languageSessionStore.cancel("documentSymbols");
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
    currentMethodsVisible ? collectCurrentClassMethods(getActiveContent(), getEditorLine()) : []
  ), [currentMethodsVisible, getActiveContent, getEditorLine]);

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
