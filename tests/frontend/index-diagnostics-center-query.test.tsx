import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter query evidence", () => {
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

  it("renders deep-layer performance event payloads as readable timeline evidence", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithPerformanceEvent()}
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

    const timeline = screen.getByRole("region", { name: "Performance Timeline" });
    expect(within(timeline).getByText("Deep-layer performance")).toBeVisible();
    expect(within(timeline).getByText("performance: slowest=referenceRefresh source=project duration=420ms samples=3 violations=1")).toBeVisible();
    expect(within(timeline).getByText("violation: referenceRefresh project 420ms > 250ms paths=128 chunk=2")).toBeVisible();
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
    const event = within(queryExplain)
      .getByText("frontend · info · definition · Entry.ets:6:49")
      .closest(".index-diagnostics__event");
    expect(event).not.toBeNull();
    expect(within(event as HTMLElement).getByText("Wait for index")).toBeVisible();
    expect(within(event as HTMLElement).getByText("FileIndex, SDKIndex")).toBeVisible();
    expect(within(event as HTMLElement).getByText("WorkspaceIndex:notReady")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Partial")).toBeVisible();
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
    const event = within(queryExplain)
      .getByText("backend · warning · textSearch · hit")
      .closest(".index-diagnostics__event");
    expect(event).not.toBeNull();
    expect(within(event as HTMLElement).getByText("1ms")).toBeVisible();
    expect(within(event as HTMLElement).getByText("Inspect index")).toBeVisible();
    expect(within(event as HTMLElement).getByText("TextIndex")).toBeVisible();
    expect(within(event as HTMLElement).getByText("none")).toBeVisible();
    expect(within(event as HTMLElement).getByText("12 / 18")).toBeVisible();
    expect(within(event as HTMLElement).getByText("searched 12 file(s), skipped 40 prefiltered file(s), limit reached: yes")).toBeVisible();
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
      "backend · warning · textSearch · hit",
      "frontend · info · completion · Entry.ets:8:4",
    ]);
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
      kind: "textSearch",
      phase: "hit",
      severity: "warning",
      message: "textSearch query returned 1 indexed result(s)",
      taskId: null,
      generation: 18,
      payloadJson: JSON.stringify({
        explain: [
          "query:textSearch",
          "used:TextIndex",
          "skipped:none",
          "resultCount:1",
          "readiness:Blocked",
          "requestedGeneration:18",
          "servedGeneration:12",
          "retryable:false",
          "searchedFiles:12",
          "prefilterSkippedFiles:40",
          "limitReached:true",
          "action:inspectIndex",
        ],
      }),
      createdAt,
    }],
  };
}

function diagnosticsWithPerformanceEvent(): WorkspaceIndexDiagnostics {
  return {
    ...diagnosticsWithBackendQueryEvent(),
    timeline: [],
    recentEvents: [{
      eventId: "perf-1",
      rootPath: "C:/workspace",
      scope: "performance",
      kind: "deep-layer",
      phase: "threshold",
      severity: "warning",
      message: "Deep-layer performance: slowest referenceRefresh from project took 420ms; 1 violation(s)",
      taskId: null,
      generation: null,
      payloadJson: JSON.stringify({
        slowestStage: "referenceRefresh",
        slowestSource: "project",
        slowestDurationMs: 420,
        sampleCount: 3,
        violations: [{
          stage: "referenceRefresh",
          source: "project",
          durationMs: 420,
          thresholdMs: 250,
          pathCount: 128,
          chunkIndex: 2,
        }],
      }),
      createdAt: 1,
    }],
  };
}
