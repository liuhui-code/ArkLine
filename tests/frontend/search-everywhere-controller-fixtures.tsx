import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import { useSearchEverywhereController } from "@/components/layout/use-search-everywhere-controller";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexQueryScope, WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";

export function renderSearchHarness(overrides: Partial<SearchHarnessOptions> = {}) {
  const stableWorkspaceApi = overrides.workspaceApi ?? workspaceApi({});
  const stableWorkspace = overrides.workspace ?? workspace();
  const queryIndexCandidates = overrides.queryIndexCandidates ?? vi.fn(() => []);
  const getTextSearchPaths = overrides.getTextSearchPaths ?? vi.fn(() => ["/workspace/Entry.ets"]);
  const getRecentPaths = overrides.getRecentPaths ?? vi.fn(() => []);
  const getOpenedPaths = overrides.getOpenedPaths ?? vi.fn(() => []);
  const replaceQueryReadiness = overrides.replaceQueryReadiness ?? vi.fn();
  const getOpenDocumentContent = overrides.getOpenDocumentContent ?? vi.fn(() => null);
  const hasDirtyDocuments = overrides.hasDirtyDocuments ?? vi.fn(() => false);
  const rememberCurrentLocation = overrides.rememberCurrentLocation ?? vi.fn();
  const navigateToLocation = overrides.navigateToLocation ?? vi.fn(async () => undefined);
  const explainIndexMiss = overrides.explainIndexMiss ?? vi.fn(async () => null);
  const recordRecentQueryExplain = overrides.recordRecentQueryExplain ?? vi.fn();
  const recordUiInteraction = overrides.recordUiInteraction ?? vi.fn();
  const onStatusChange = overrides.onStatusChange ?? vi.fn();
  return renderHook(() => {
    const [overlay, setOverlay] = useState<OverlayKey>(overrides.overlay ?? "none");
    const [query, setQuery] = useState(overrides.query ?? "");
    const search = useSearchEverywhereController({
      workspaceApi: stableWorkspaceApi,
      workspace: stableWorkspace,
      activePath: overrides.activePath ?? "/workspace/Entry.ets",
      editorSelectedText: overrides.editorSelectedText ?? "",
      quickOpenQuery: query,
      activeOverlay: overlay,
      indexVersionKey: "ready:1",
      setQuickOpenQuery: setQuery,
      setActiveOverlay: setOverlay,
      queryIndexCandidates,
      getTextSearchPaths,
      getRecentPaths,
      getOpenedPaths,
      replaceQueryReadiness,
      getOpenDocumentContent,
      getActiveContent: () => overrides.editorContent ?? "struct Entry {}",
      hasDirtyDocuments,
      rememberCurrentLocation,
      navigateToLocation,
      explainIndexMiss,
      recordRecentQueryExplain,
      recordUiInteraction,
      onStatusChange,
    });
    return { search, overlay, query };
  });
}

export async function flushSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

export async function flushPreviewDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
  });
}

export type SearchHarnessOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  editorContent: string;
  editorSelectedText: string;
  query: string;
  overlay: OverlayKey;
  queryIndexCandidates: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
  getTextSearchPaths: () => string[];
  getRecentPaths: () => string[];
  getOpenedPaths: () => string[];
  replaceQueryReadiness: (readiness: WorkspaceIndexReadiness) => void;
  getOpenDocumentContent: (path: string) => string | null;
  hasDirtyDocuments: () => boolean;
  rememberCurrentLocation: () => void;
  navigateToLocation: (location: { path: string; line: number; column: number }, label: "Usage") => Promise<void>;
  explainIndexMiss: (kind: "search", query: string) => Promise<string | null>;
  recordRecentQueryExplain: Parameters<typeof useSearchEverywhereController>[0]["recordRecentQueryExplain"];
  recordUiInteraction: Parameters<typeof useSearchEverywhereController>[0]["recordUiInteraction"];
  onStatusChange: (message: string) => void;
};

export function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(async () => ""),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    loadDiff: vi.fn(),
    inspectEnvironment: vi.fn(),
    saveSettings: vi.fn(),
    loadSettings: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceApi;
}

export function readiness() {
  return {
    rootPath: "/workspace",
    requestedGeneration: 1,
    servedGeneration: 1,
    state: "ready" as const,
    retryable: false,
  };
}

export function candidate(overrides: Partial<SearchCandidate>): SearchCandidate {
  return {
    id: "symbol:EntryAbility",
    source: "symbol",
    kind: "class",
    title: "EntryAbility",
    subtitle: "EntryAbility.ets",
    score: 1,
    freshness: "ready",
    ...overrides,
  };
}

export function rapidSearchQueries(finalQuery: string) {
  const growing = Array.from({ length: finalQuery.length }, (_, index) => finalQuery.slice(0, index + 1));
  const shrinking = Array.from({ length: finalQuery.length }, (_, index) => finalQuery.slice(0, finalQuery.length - index - 1));
  return [...growing, ...shrinking, ...growing];
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function workspace(): WorkspaceViewModel {
  return {
    rootName: "workspace",
    rootPath: "/workspace",
    visibleFiles: ["/workspace/Entry.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 1,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}
