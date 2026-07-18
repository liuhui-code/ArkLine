import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import { buildLanguageQuerySnapshot } from "@/components/layout/language-query-request-model";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter", () => {
  afterEach(() => {
    languageQuerySnapshotStore.clear();
  });

  it("renders semantic supervisor health and memory evidence", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[]}
        semanticState={{
          provider: "semantic-host",
          mode: "semantic",
          detail: "ready",
          supervisor: {
            status: "running",
            restartCount: 3,
            restoredDocumentCount: 12,
            consecutiveFailures: 0,
            lastHeartbeatEpochMs: Date.now(),
            retryAfterMs: 0,
            lastError: null,
            runtime: {
              rssBytes: 128 * 1024 * 1024,
              heapUsedBytes: 64 * 1024 * 1024,
              heapTotalBytes: 96 * 1024 * 1024,
              externalBytes: 1024,
              uptimeMs: 4200,
            },
            memoryBudgetBytes: 1024 * 1024 * 1024,
          },
        }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const semantic = screen.getByRole("region", { name: "Semantic Host" });
    expect(within(semantic).getByText("running")).toBeVisible();
    expect(within(semantic).getByText("128 MiB")).toBeVisible();
    expect(within(semantic).getByText("1024 MiB")).toBeVisible();
    expect(within(semantic).getByText("12")).toBeVisible();
  });

  it("renders discovery progress facts in health storage", () => {
    const diagnostics = diagnosticsWithBackendQueryEvent();
    diagnostics.discoveryStatus = "running";
    diagnostics.discoveredFileCount = 2048;
    diagnostics.discoveryExcludedCount = 12;
    diagnostics.discoveryHasMore = true;
    diagnostics.writerMetrics = {
      sampleCount: 128,
      activeWriterCount: 1,
      queuedWriterCount: 2,
      failureCount: 3,
      waitP50Us: 500,
      waitP95Us: 2_500,
      waitP99Us: 4_000,
      waitMaxUs: 8_000,
      holdP50Us: 4_000,
      holdP95Us: 12_000,
      holdP99Us: 16_000,
      holdMaxUs: 20_000,
      lastWaitUs: 1_000,
      lastHoldUs: 6_000,
    };
    diagnostics.indexerHost = {
      enabled: true,
      status: "running",
      processId: 4312,
      discoveryProcessId: 4312,
      contentProcessId: 4313,
      stubProcessId: 4314,
      stubWriterMetrics: diagnostics.writerMetrics,
      completedDiscoveryChunks: 7,
      completedContentRefreshChunks: 6,
      cancelledContentRefreshChunks: 1,
      completedStubRefreshChunks: 5,
      cancelledStubRefreshChunks: 2,
      fallbackCount: 1,
      restartCount: 2,
      consecutiveFailureCount: 1,
      backoffRemainingMs: 250,
      lastError: null,
    };

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnostics}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const health = screen.getByRole("region", { name: "Health / Storage" });
    expect(within(health).getByText("1 active / 2 queued")).toBeVisible();
    expect(within(health).getByText("Writer wait p95 / max").nextElementSibling).toHaveTextContent("2.50 ms / 8.00 ms");
    expect(within(health).getByText("Writer hold p95 / max").nextElementSibling).toHaveTextContent("12.0 ms / 20.0 ms");
    expect(within(health).getByText("Writer samples / failures").nextElementSibling).toHaveTextContent("128 / 3");
    expect(within(health).getByText("Indexer writer wait worst p95 / max").nextElementSibling).toHaveTextContent("2.50 ms / 8.00 ms");
    expect(within(health).getByText("Indexer writer hold worst p95 / max").nextElementSibling).toHaveTextContent("12.0 ms / 20.0 ms");
    expect(within(health).getByText("Indexer writer samples / failures").nextElementSibling).toHaveTextContent("128 / 3");

    expect(within(health).getByText("Discovery")).toBeVisible();
    expect(within(health).getAllByText("running")).toHaveLength(2);
    expect(within(health).getByText("4312")).toBeVisible();
    expect(within(health).getByText("7")).toBeVisible();
    expect(within(health).getByText("Content chunks").nextElementSibling).toHaveTextContent("6");
    expect(within(health).getByText("Discovered files")).toBeVisible();
    expect(within(health).getByText("2,048")).toBeVisible();
    expect(within(health).getByText("Excluded entries")).toBeVisible();
    expect(within(health).getByText("12")).toBeVisible();
    expect(within(health).getByText("Discovery cursor")).toBeVisible();
    expect(within(health).getByText("has more")).toBeVisible();
    expect(within(health).getByText("Cancelled chunks").nextElementSibling).toHaveTextContent("2");
  });

  it("renders index layer freshness evidence in health storage", () => {
    const diagnostics = diagnosticsWithBackendQueryEvent();
    diagnostics.freshnessLayers = [{
      layer: "content",
      readyCount: 1200,
      staleCount: 3,
      missingCount: 4,
      expectedVersion: 1,
    }];

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnostics}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const freshness = screen.getByLabelText("Layer Freshness");
    expect(within(freshness).getByText("content")).toBeVisible();
    expect(within(freshness).getByText("1,200")).toBeVisible();
    expect(within(freshness).getByText("3")).toBeVisible();
    expect(within(freshness).getByText("4")).toBeVisible();
  });

  it("renders schema version rebuild evidence and triggers project rebuild", () => {
    const diagnostics = diagnosticsWithBackendQueryEvent();
    diagnostics.repairActions = ["rebuildProjectIndex"];
    diagnostics.schemaVersionActions = [{
      domain: "content",
      expectedVersion: 1,
      persistedVersion: 0,
      status: "needs-rebuild",
    }];
    const onRebuildProjectIndex = vi.fn();

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnostics}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={onRebuildProjectIndex}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const health = screen.getByRole("region", { name: "Health / Storage" });
    expect(within(health).getByText("Schema Rebuild Required")).toBeVisible();
    expect(within(health).getByText("content")).toBeVisible();
    expect(within(health).getByText("0 -> 1")).toBeVisible();

    fireEvent.click(within(health).getByRole("button", { name: "Rebuild Project Index" }));

    expect(onRebuildProjectIndex).toHaveBeenCalledTimes(1);
  });

  it("surfaces active project indexing progress near the diagnostics header", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[{
          taskId: "rebuild-1",
          rootPath: "C:/workspace",
          kind: "refresh-workspace",
          status: "running",
          reason: "diagnostics rebuild",
          generation: 3,
          progressCurrent: 42,
          progressTotal: 100,
          startedAt: 1_000,
          lastHeartbeatAt: 3_500,
        }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const activeTask = screen.getByRole("status", { name: "Active Index Task" });
    expect(within(activeTask).getByText("Project index task running")).toBeVisible();
    expect(within(activeTask).getByText("refresh-workspace")).toBeVisible();
    expect(within(activeTask).getByText("42/100 (42%)")).toBeVisible();
    expect(within(activeTask).getByText("diagnostics rebuild")).toBeVisible();
  });

  it("renders workspace and current-file layer readiness", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={{
          rootPath: "C:/workspace",
          currentFilePath: "C:/workspace/src/Entry.ets",
          layers: [
            {
              layer: "fileCatalog",
              workspaceStatus: "ready",
              currentFileStatus: "ready",
              indexedCount: 120,
              failedCount: 0,
              staleCount: 0,
              reason: null,
              recommendedAction: null,
            },
            {
              layer: "symbols",
              workspaceStatus: "partial",
              currentFileStatus: "missing",
              indexedCount: 42,
              failedCount: 2,
              staleCount: 7,
              reason: "Current file symbols are not ready.",
              recommendedAction: "indexCurrentFile",
            },
          ],
        }}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const layers = screen.getByRole("region", { name: "Index Layers" });
    expect(screen.getByText("Index: Degraded, 2 failures")).toBeVisible();
    expect(within(layers).getByText("fileCatalog")).toBeVisible();
    expect(within(layers).getByText("symbols")).toBeVisible();
    expect(within(layers).getByText("partial")).toBeVisible();
    expect(within(layers).getByText("missing")).toBeVisible();
    expect(within(layers).getByText("42 indexed · 2 failed · 7 stale")).toBeVisible();
    expect(within(layers).getByText("Files · Quick open")).toBeVisible();
    expect(within(layers).getByText("Symbols · Navigation")).toBeVisible();
    expect(within(layers).getByRole("button", { name: "Index Current File" })).toBeVisible();
    expect(within(layers).getByText("Current file symbols are not ready.")).toBeVisible();
  });

  it("renders current-file discovery readiness evidence", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={{
          rootPath: "C:/workspace",
          path: "C:/workspace/src/Entry.ets",
          fileName: "Entry.ets",
          discoveryIndex: "ready",
          fileIndex: "missing",
          contentIndex: "missing",
          symbolIndex: "missing",
          parserStatus: "unknown",
          parserError: null,
          indexedGeneration: null,
          semanticLayers: [],
          definitionAvailable: false,
          completionAvailable: false,
          usagesAvailable: false,
          searchAvailable: true,
          reason: "Entry.ets was discovered but has not completed foreground file catalog indexing.",
        }}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const currentFile = screen.getByRole("region", { name: "Current File Readiness" });
    expect(within(currentFile).getByText("Discovery")).toBeVisible();
    expect(within(currentFile).getByText("ready")).toBeVisible();
    expect(within(currentFile).getByText("Entry.ets was discovered but has not completed foreground file catalog indexing.")).toBeVisible();
  });

  it("renders recent language query snapshot metadata", () => {
    languageQuerySnapshotStore.record({
      kind: "completion",
      snapshot: buildLanguageQuerySnapshot({
        activePath: "C:/workspace/src/Entry.ets",
        editorSelection: { line: 6, column: 12 },
        getActiveContent: () => "Button().width",
      }),
      createdAt: 1,
    });

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const snapshots = screen.getByRole("region", { name: "Language Query Snapshots" });
    expect(within(snapshots).getByText("completion · Entry.ets:6:12")).toBeVisible();
    expect(within(snapshots).getByText("normal · Sync OK")).toBeVisible();
    expect(within(snapshots).getByText("14 chars · Full content request")).toBeVisible();
  });
});

function diagnosticsWithBackendQueryEvent(createdAt = 1): WorkspaceIndexDiagnostics {
  return {
    rootPath: "C:/workspace",
    status: "partial",
    schemaVersions: {},
    schemaVersionActions: [],
    freshnessLayers: [],
    fileCount: 10,
    symbolCount: 20,
    contentLineCount: 30,
    fingerprintCount: 10,
    stubFileCount: 10,
    stubDeclarationCount: 20,
    dependencyEdgeCount: 0,
    unresolvedImportCount: 0,
    parserErrorCount: 0,
    staleGenerationCount: 1,
    sdkSymbolCount: 5,
    discoveryStatus: null,
    discoveredFileCount: 0,
    discoveryExcludedCount: 0,
    discoveryHasMore: false,
    dbSizeBytes: 1024,
    queuePressure: {
      rootPath: "C:/workspace",
      pendingTaskCount: 0,
      workspacePendingTaskCount: 0,
      highestPriority: null,
      highestPriorityTaskKind: null,
    },
    activeSdkPath: null,
    activeSdkVersion: null,
    lastError: null,
    lastExplainStatus: null,
    retryBackoffCount: 0,
    latestRetryBackoff: null,
    repairActions: [],
    parserFailures: [],
    unresolvedImports: [],
    timeline: [],
    recentEvents: [{
      eventId: "event-1",
      rootPath: "C:/workspace",
      scope: "query",
      kind: "definition",
      phase: "blocked",
      severity: "warning",
      message: "definition query blocked by index readiness",
      taskId: null,
      generation: 18,
      payloadJson: JSON.stringify({
        explain: [
          "query:definition",
          "used:FileIndex,SDKIndex",
          "skipped:WorkspaceIndex:notReady",
          "resultCount:0",
          "readiness:Blocked",
          "requestedGeneration:18",
          "servedGeneration:12",
          "retryable:false",
          "action:inspectIndex",
        ],
      }),
      createdAt,
    }],
  };
}
