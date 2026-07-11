import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import { buildLanguageQuerySnapshot } from "@/components/layout/language-query-request-model";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter", () => {
  afterEach(() => {
    languageQuerySnapshotStore.clear();
  });

  it("renders UI latency evidence in the performance timeline", () => {
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
        uiLatencySamples={[{
          kind: "globalSearch",
          startedAt: 2_000,
          durationMs: 345,
          label: "width",
        }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const timeline = screen.getByRole("region", { name: "Performance Timeline" });
    expect(within(timeline).getByText("UI responsiveness")).toBeVisible();
    expect(within(timeline).getByText("globalSearch · width")).toBeVisible();
    expect(within(timeline).getByText("345ms")).toBeVisible();
  });

  it("renders query explain actions and evidence as readable diagnostics", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[{
          id: "query-1",
          kind: "definition",
          query: "Entry.ets:6:49",
          message: "Index is still catching up. Retry after indexing finishes.",
          explain: [
            "query:definition",
            "used:FileIndex,SDKIndex",
            "skipped:WorkspaceIndex:notReady",
            "resultCount:0",
            "readiness:Partial",
            "requestedGeneration:18",
            "servedGeneration:12",
            "retryable:true",
            "action:waitForIndex",
          ],
          createdAt: 1,
        }]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const queryExplain = screen.getByRole("region", { name: "Query Explain" });
    const event = within(queryExplain).getByText("frontend · info · definition · Entry.ets:6:49").closest(".index-diagnostics__event");
    expect(event).not.toBeNull();
    expect(within(event as HTMLElement).getByText("Action")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Wait for index")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Used")).toBeVisible();
    expect(within(event as HTMLElement).getByText("FileIndex, SDKIndex")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Skipped")).toBeVisible();
    expect(within(event as HTMLElement).getByText("WorkspaceIndex:notReady")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Readiness")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Partial")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Result count")).toBeVisible();
    expect(within(event as HTMLElement).getByText("0")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Generation")).toBeVisible();
    expect(within(event as HTMLElement).getByText("12 / 18")).toBeVisible();
  });

  it("renders backend query event payload explain as readable diagnostics", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithBackendQueryEvent()}
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

    const queryExplain = screen.getByRole("region", { name: "Query Explain" });
    const event = within(queryExplain).getByText("backend · warning · definition · blocked").closest(".index-diagnostics__event");
    expect(event).not.toBeNull();
    expect(within(event as HTMLElement).getByText("1ms")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Action")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Inspect index")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Used")).toBeVisible();
    expect(within(event as HTMLElement).getByText("FileIndex, SDKIndex")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Skipped")).toBeVisible();
    expect(within(event as HTMLElement).getByText("WorkspaceIndex:notReady")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Generation")).toBeVisible();
    expect(within(event as HTMLElement).getByText("12 / 18")).toBeVisible();
  });

  it("renders frontend and backend query evidence in one newest-first timeline", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithBackendQueryEvent(20)}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[{
          id: "query-older",
          kind: "completion",
          query: "Entry.ets:8:4",
          message: "Completion waits for current file symbols",
          explain: ["query:completion", "readiness:Partial", "action:waitForIndex"],
          createdAt: 10,
        }]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const queryExplain = screen.getByRole("region", { name: "Query Explain" });
    const events = within(queryExplain).getAllByText(/^(backend|frontend) ·/);
    expect(events.map((event) => event.textContent)).toEqual([
      "backend · warning · definition · blocked",
      "frontend · info · completion · Entry.ets:8:4",
    ]);
  });

  it("renders discovery progress facts in health storage", () => {
    const diagnostics = diagnosticsWithBackendQueryEvent();
    diagnostics.discoveryStatus = "running";
    diagnostics.discoveredFileCount = 2048;
    diagnostics.discoveryExcludedCount = 12;
    diagnostics.discoveryHasMore = true;

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
    expect(within(health).getByText("Discovery")).toBeVisible();
    expect(within(health).getByText("running")).toBeVisible();
    expect(within(health).getByText("Discovered files")).toBeVisible();
    expect(within(health).getByText("2,048")).toBeVisible();
    expect(within(health).getByText("Excluded entries")).toBeVisible();
    expect(within(health).getByText("12")).toBeVisible();
    expect(within(health).getByText("Discovery cursor")).toBeVisible();
    expect(within(health).getByText("has more")).toBeVisible();
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
    expect(within(layers).getByText("indexCurrentFile")).toBeVisible();
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
