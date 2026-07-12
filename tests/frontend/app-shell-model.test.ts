import { describe, expect, it, vi } from "vitest";
import { getAppShellDerivedState } from "@/components/layout/app-shell-derived-state";
import {
  actionMatchesSource,
  clampNumber,
  constrainCompletionPopupPosition,
  filterSearchCandidatesByScope,
  getCompletionPopupPosition,
  getIndexDiagnosticsStatusTarget,
  getIndexHealthStatusText,
  getIndexStatusText,
  getLayerReadinessStatusText,
  getSdkIndexStatusText,
  getWorkspacePartialNotice,
  getWorkspaceScanText,
  mergeWorkspaceIndexTaskStatus,
  pathWithinDirectory,
  replaceDirectoryPrefix,
  searchEverywhereEntityCandidates,
  uniqueNormalizedPaths,
} from "@/components/layout/app-shell-model";
import type { CodeAction } from "@/features/code-actions/code-action-model";
import type {
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api";
import { createWorkspaceIndexStore, type SearchCandidate, type WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

describe("app shell model", () => {
  it("clamps numeric values and normalizes unique paths", () => {
    expect(clampNumber(5, 10, 20)).toBe(10);
    expect(clampNumber(25, 10, 20)).toBe(20);
    expect(clampNumber(15, 10, 20)).toBe(15);
    expect(uniqueNormalizedPaths(["/workspace//b.ets", "/workspace/a.ets", "/workspace/b.ets"]))
      .toEqual(["/workspace/a.ets", "/workspace/b.ets"]);
  });

  it("matches and rewrites paths inside directories", () => {
    expect(pathWithinDirectory("/workspace/src/A.ets", "/workspace/src")).toBe(true);
    expect(pathWithinDirectory("/workspace/src", "/workspace/src")).toBe(true);
    expect(pathWithinDirectory("/workspace/src-extra/A.ets", "/workspace/src")).toBe(false);
    expect(replaceDirectoryPrefix("/workspace/src/A.ets", "/workspace/src", "/workspace/lib"))
      .toBe("/workspace/lib/A.ets");
  });

  it("matches code actions by command source", () => {
    const rename = codeAction({ id: "rename.symbol", title: "Rename Symbol", kind: "refactor.rewrite" });
    const generate = codeAction({ id: "generate.constructor", title: "Generate Constructor", kind: "source" });
    const extract = codeAction({ id: "extract.method", title: "Extract Method", kind: "refactor.extract" });

    expect(actionMatchesSource(rename, "all")).toBe(true);
    expect(actionMatchesSource(rename, "rename")).toBe(true);
    expect(actionMatchesSource(generate, "generate")).toBe(true);
    expect(actionMatchesSource(extract, "refactor")).toBe(true);
    expect(actionMatchesSource(generate, "rename")).toBe(false);
  });

  it("positions completion popup with fallback and viewport constraints", () => {
    expect(constrainCompletionPopupPosition(0, -20)).toEqual({ top: 12, left: 12 });
    expect(getCompletionPopupPosition(null)).toEqual({ top: 96, left: 280 });

    const originalInnerHeight = window.innerHeight;
    vi.stubGlobal("innerHeight", 420);
    expect(getCompletionPopupPosition({
      line: 1,
      column: 1,
      top: 360,
      bottom: 380,
      left: 280,
      right: 300,
      measured: true,
    })).toEqual({ top: 16, left: 280 });
    vi.stubGlobal("innerHeight", originalInnerHeight);
  });

  it("formats workspace scan and partial notices", () => {
    expect(getWorkspaceScanText(null)).toBeNull();
    expect(getWorkspaceScanText(workspace({ truncated: false, visibleFiles: ["/a.ets", "/b.ets"] })))
      .toBe("Workspace: ready (2 files)");
    expect(getWorkspaceScanText(workspace({ truncated: true, visibleFiles: ["/a.ets"] })))
      .toBe("Workspace: partial (1 files)");
    expect(getWorkspacePartialNotice(workspace({ truncated: false }))).toBeNull();
    expect(getWorkspacePartialNotice(workspace({ truncated: true, scannedFiles: 1000, skippedEntries: 12 })))
      .toBe("Partial workspace results: scan stopped at 1,000 files; excluded 12 generated/dependency entries.");
  });

  it("formats index and sdk status text", () => {
    expect(getIndexStatusText(indexState({ status: "empty" }))).toBe("Index: empty");
    expect(getIndexStatusText(indexState({ status: "partial", filePaths: [] }))).toBe("Index: building project");
    expect(getIndexStatusText(indexState({ status: "ready", filePaths: ["/a.ets", "/b.ets"] })))
      .toBe("Index: ready (2 files)");
    expect(getIndexStatusText(indexState({ status: "ready" }), [
      taskStatus({ kind: "open-workspace", status: "running", progressCurrent: 4, progressTotal: 10 }),
    ])).toBe("Index: running project · 4/10 (40%)");
    expect(getIndexStatusText(indexState({ status: "partial" }), [
      taskStatus({ kind: "discovery", status: "running", progressCurrent: 0, progressTotal: 1 }),
    ])).toBe("Index: Discovering files");
    expect(getIndexStatusText(indexState({ status: "partial" }), [
      taskStatus({ kind: "discovery", status: "partial", progressCurrent: 1024, progressTotal: 1025 }),
    ])).toBe("Index: Discovering files (1,024+)");
    expect(getIndexStatusText(indexState({ status: "ready" }), [
      taskStatus({ kind: "refresh-workspace", stalled: true }),
    ])).toBe("Index: Stalled, 1 task > 60s");
    expect(getIndexHealthStatusText({ retryBackoffCount: 1, latestRetryBackoff: null }))
      .toBe("Index: Backoff, 1 retry delayed");
    expect(getIndexHealthStatusText({ retryBackoffCount: 2, latestRetryBackoff: "recommended retry delay 2000ms" }))
      .toBe("Index: Backoff, recommended retry delay 2000ms");
    expect(getIndexHealthStatusText({ retryBackoffCount: 0, latestRetryBackoff: null })).toBeNull();
    expect(getIndexDiagnosticsStatusTarget("Index: Backoff, recommended retry delay 2000ms"))
      .toBe("index-diagnostics-health");
    expect(getIndexDiagnosticsStatusTarget("Index: ready (2 files)"))
      .toBe("index-diagnostics-processes");
    expect(getSdkIndexStatusText([
      taskStatus({ kind: "sdk", status: "running", progressCurrent: 7, progressTotal: 20 }),
    ])).toBe("SDK API: running · 7/20 (35%)");
    expect(getSdkIndexStatusText([
      taskStatus({ kind: "sdk", status: "running", stalled: true }),
    ])).toBe("SDK API: stalled · No heartbeat > 60s");
    expect(getSdkIndexStatusText([taskStatus({ kind: "sdk", status: "ready", symbolCount: 42 })]))
      .toBe("SDK API: ready (42 symbols)");
  });

  it("summarizes layer readiness with degraded and current-file states first", () => {
    expect(getLayerReadinessStatusText(null)).toBeNull();
    expect(getLayerReadinessStatusText(layerReadiness([
      layer({ layer: "fileCatalog", workspaceStatus: "ready", currentFileStatus: "ready" }),
      layer({ layer: "symbols", workspaceStatus: "ready", currentFileStatus: "ready" }),
    ]))).toBe("Index: Ready, current file ready");
    expect(getLayerReadinessStatusText(layerReadiness([
      layer({ layer: "content", workspaceStatus: "partial", currentFileStatus: "ready" }),
      layer({ layer: "symbols", workspaceStatus: "missing", currentFileStatus: "missing" }),
    ]))).toBe("Index: Partial, current file ready");
    expect(getLayerReadinessStatusText(layerReadiness([
      layer({ layer: "symbols", workspaceStatus: "failed", currentFileStatus: "missing", failedCount: 3 }),
    ]))).toBe("Index: Degraded, 3 failures");
    expect(getLayerReadinessStatusText(layerReadiness([
      layer({ layer: "symbols", workspaceStatus: "missing", currentFileStatus: "missing" }),
    ]))).toBe("Index: Missing, current file not ready");
  });

  it("merges task statuses and filters search candidates", () => {
    expect(mergeWorkspaceIndexTaskStatus([
      taskStatus({ taskId: "old", generation: 2 }),
      taskStatus({ taskId: "replace", generation: 1 }),
    ], taskStatus({ taskId: "replace", generation: 3 })).map((item) => item.taskId))
      .toEqual(["old", "replace"]);

    const candidates = [
      searchCandidate({ id: "file", source: "file" }),
      searchCandidate({ id: "class", source: "class" }),
      searchCandidate({ id: "text", source: "text" }),
    ];
    expect(filterSearchCandidatesByScope(candidates, "files").map((candidate) => candidate.id)).toEqual(["file"]);
    expect(filterSearchCandidatesByScope(candidates, "all")).toEqual(candidates);
    expect(searchEverywhereEntityCandidates(candidates).map((candidate) => candidate.id)).toEqual(["file", "class"]);
  });

  it("derives search, overlay, and status bar state from shell inputs", () => {
    const workspaceModel = workspace({
      truncated: false,
      visibleFiles: ["/workspace/src/Main.ets", "/workspace/src/Settings.ets"],
    });
    const index = createWorkspaceIndexStore();
    index.openWorkspace(workspaceModel);

    const derived = getAppShellDerivedState({
      workspace: workspaceModel,
      workspaceIndex: index,
      workspaceIndexState: index.state,
      workspaceIndexStatusSummary: {
        workspaceIndexText: "Index: ready (2 files)",
        sdkIndexText: null,
      },
      quickOpenQuery: "set",
      recentFiles: ["/workspace/src/Main.ets", "/workspace/src/Settings.ets"],
      recentProjects: ["/workspace/settings-project"],
      activeOverlay: "searchEverywhere",
      searchEverywhereMode: "find",
      searchEverywhereTruncationNotice: null,
      semanticState: semanticState(),
      settingsApplyState: "idle",
    });

    expect(derived.quickOpenResults).toEqual([]);
    expect(derived.recentFileResults).toEqual([]);
    expect(derived.recentProjectResults).toEqual([]);
    expect(derived.overlayVisible).toBe(true);
    expect(derived.overlayLabel).toBe("Find in Files");
    expect(derived.workspaceIndexText).toBe("Index: ready (2 files)");
  });

  it("derives status bar index text from projected index summary", () => {
    const derived = getAppShellDerivedState({
      workspace: workspace({ truncated: false, visibleFiles: ["/workspace/Entry.ets"] }),
      workspaceIndex: createWorkspaceIndexStore(),
      workspaceIndexState: indexState({ status: "partial", filePaths: [] }),
      workspaceIndexStatusSummary: {
        workspaceIndexText: "Index: Degraded, 1 failure",
        sdkIndexText: null,
      },
      quickOpenQuery: "",
      recentFiles: [],
      recentProjects: [],
      activeOverlay: "none",
      searchEverywhereMode: "searchEverywhere",
      searchEverywhereTruncationNotice: null,
      semanticState: semanticState(),
      settingsApplyState: "idle",
    });

    expect(derived.workspaceIndexText).toBe("Index: Degraded, 1 failure");
  });

  it("prioritizes explicit search truncation before stale index readiness notices", () => {
    const derived = getAppShellDerivedState({
      workspace: workspace({ truncated: true, scannedFiles: 500, skippedEntries: 7 }),
      workspaceIndex: createWorkspaceIndexStore(),
      workspaceIndexState: indexState({
        partialReason: "Workspace index is partial",
        queryReadiness: {
          state: "partial",
          reason: "Index still building",
          rootPath: "/workspace",
          requestedGeneration: 2,
          servedGeneration: 1,
          retryable: true,
        },
      }),
      workspaceIndexStatusSummary: {
        workspaceIndexText: "Index: Partial",
        sdkIndexText: null,
      },
      quickOpenQuery: "",
      recentFiles: [],
      recentProjects: [],
      activeOverlay: "quickOpen",
      searchEverywhereMode: "find",
      searchEverywhereTruncationNotice: "Showing first 200 matches",
      semanticState: semanticState(),
      settingsApplyState: "idle",
    });

    expect(derived.workspacePartialNotice).toBe("Showing first 200 matches");
  });
});

function codeAction(action: Partial<CodeAction>): CodeAction {
  return {
    id: "action",
    title: "Action",
    kind: "quickfix",
    provider: "arkts",
    safety: "safe",
    disabledReason: null,
    ...action,
  } as CodeAction;
}

function layerReadiness(layers: WorkspaceIndexLayerReadinessReport["layers"]): WorkspaceIndexLayerReadinessReport {
  return {
    rootPath: "/workspace",
    currentFilePath: "/workspace/Entry.ets",
    layers,
  };
}

function layer(overrides: Partial<WorkspaceIndexLayerReadinessReport["layers"][number]> = {}) {
  return {
    layer: "content",
    workspaceStatus: "ready",
    currentFileStatus: "ready",
    indexedCount: 1,
    failedCount: 0,
    staleCount: 0,
    reason: null,
    recommendedAction: null,
    ...overrides,
  };
}

function workspace(input: {
  truncated: boolean;
  visibleFiles?: string[];
  scannedFiles?: number;
  skippedEntries?: number;
}): WorkspaceViewModel {
  return {
    rootPath: "/workspace",
    rootName: "workspace",
    visibleFiles: input.visibleFiles ?? [],
    fileTree: [],
    scanSummary: {
      scannedFiles: input.scannedFiles ?? 0,
      skippedEntries: input.skippedEntries ?? 0,
      truncated: input.truncated,
      excludeRules: [],
    },
  };
}

function indexState(input: Partial<WorkspaceIndexState>): WorkspaceIndexState {
  return {
    status: "ready",
    rootPath: "/workspace",
    filePaths: [],
    indexedAt: 1,
    partialReason: null,
    ...input,
  };
}

function taskStatus(input: Partial<WorkspaceIndexTaskStatus>): WorkspaceIndexTaskStatus {
  return {
    taskId: "task",
    rootPath: "/workspace",
    kind: "open-workspace",
    status: "queued",
    reason: "",
    generation: 1,
    progressCurrent: 0,
    progressTotal: 0,
    ...input,
  };
}

function searchCandidate(input: Partial<SearchCandidate>): SearchCandidate {
  return {
    id: "candidate",
    source: "file",
    kind: "file",
    title: "Candidate",
    subtitle: "",
    score: 1,
    freshness: "ready",
    ...input,
  };
}

function semanticState() {
  return {
    provider: "arkts",
    mode: "semantic" as const,
    detail: "Ready",
  };
}
