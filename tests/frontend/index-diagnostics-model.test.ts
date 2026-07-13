import { describe, expect, it } from "vitest";
import {
  buildIndexDiagnosticsViewModel,
  buildActiveProjectTaskSummary,
  buildActiveSdkTaskSummary,
  buildIndexDiagnosticsEvidenceReport,
  buildRepairActionEvidence,
  formatRepairAction,
  formatTaskDuration,
  formatTaskTargets,
  getLayerActionState,
} from "@/components/layout/index-diagnostics-model";
import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexEvent } from "@/features/workspace/workspace-index-api-types";

describe("index diagnostics model", () => {
  it("builds header, storage, and timeline summary text", () => {
    const model = buildIndexDiagnosticsViewModel({
      diagnostics: {
        status: "partial",
        fileCount: 1234,
        dbSizeBytes: 2_621_440,
        timelineCount: 2,
      },
      layerStatusText: null,
      uiLatencyCount: 1,
      ipcLatencyCount: 2,
      renderPressureCount: 3,
    });

    expect(model.headerStatusText).toBe("partial · 1,234 files");
    expect(model.dbSize).toBe("2.5 MB");
    expect(model.timelineCount).toBe(8);
  });

  it("prefers layer readiness status in the header", () => {
    const model = buildIndexDiagnosticsViewModel({
      diagnostics: null,
      layerStatusText: "Index: Ready",
      uiLatencyCount: 0,
      ipcLatencyCount: 0,
      renderPressureCount: 0,
    });

    expect(model.headerStatusText).toBe("Index: Ready");
    expect(model.dbSize).toBe("0 KB");
    expect(model.timelineCount).toBe(0);
  });

  it("formats task duration and repair actions", () => {
    expect(formatTaskDuration(task({ startedAt: 1_000, finishedAt: 2_250 }))).toBe("1.3s total");
    expect(formatTaskDuration(task({ startedAt: 1_000, lastHeartbeatAt: 61_500 }))).toBe("1m 0s active");
    expect(formatRepairAction("inspectParserFailures")).toBe("Inspect Parser Failures");
  });

  it("formats bounded task target path samples", () => {
    expect(formatTaskTargets(task({}))).toBe("-");
    expect(formatTaskTargets(task({
      targetPaths: [
        "/workspace/src/Entry.ets",
        "C:\\workspace\\feature\\List.ets",
      ],
    }))).toBe("src/Entry.ets, feature/List.ets");
    expect(formatTaskTargets(task({
      targetPaths: ["/workspace/src/Entry.ets", "/workspace/src/Other.ets"],
      targetPathCount: 5,
    }))).toBe("src/Entry.ets, src/Other.ets +3 more");
  });

  it("summarizes the active project index task and ignores sdk tasks", () => {
    const summary = buildActiveProjectTaskSummary([
      task({ taskId: "sdk-1", kind: "sdk", status: "running", progressCurrent: 1, progressTotal: 100 }),
      task({
        taskId: "project-1",
        kind: "refresh-workspace",
        status: "running",
        reason: "diagnostics rebuild",
        progressCurrent: 42,
        progressTotal: 100,
        startedAt: 1_000,
        lastHeartbeatAt: 3_500,
      }),
    ]);

    expect(summary).toEqual({
      title: "Project index task running",
      kind: "refresh-workspace",
      status: "running",
      progress: "42/100 (42%)",
      duration: "2.5s active",
      detail: "diagnostics rebuild",
      targetSummary: null,
      targetCurrentFile: false,
    });
  });

  it("ignores terminal project and sdk task statuses in active summaries", () => {
    const projectSummary = buildActiveProjectTaskSummary([
      task({ taskId: "cancelled-1", kind: "changed-paths", status: "cancelled" }),
      task({ taskId: "superseded-1", kind: "refresh-workspace", status: "superseded" }),
      task({ taskId: "skipped-1", kind: "changed-paths", status: "skipped" }),
    ]);
    const sdkSummary = buildActiveSdkTaskSummary([
      task({ taskId: "sdk-1", kind: "sdk", status: "superseded" }),
    ]);

    expect(projectSummary).toBeNull();
    expect(sdkSummary).toBeNull();
  });

  it("includes compact targets in active project task summaries", () => {
    const summary = buildActiveProjectTaskSummary([
      task({
        taskId: "project-1",
        kind: "changed-paths",
        status: "queued",
        reason: "foreground-navigation",
        targetPaths: ["/workspace/src/Entry.ets", "/workspace/features/Search.ets"],
        targetPathCount: 3,
      }),
    ]);

    expect(summary?.targetSummary).toBe("src/Entry.ets, features/Search.ets +1 more");
  });

  it("marks active project tasks that target the current editor file", () => {
    const summary = buildActiveProjectTaskSummary([
      task({
        taskId: "project-1",
        kind: "changed-paths",
        status: "running",
        targetPaths: ["C:\\workspace\\src\\Entry.ets"],
      }),
    ], "c:/workspace/src/Entry.ets");

    expect(summary?.targetCurrentFile).toBe(true);
    expect(summary?.targetSummary).toBe("src/Entry.ets");
  });

  it("does not disable layer actions for terminal task statuses", () => {
    expect(getLayerActionState("rebuildIndex", [
      task({ taskId: "superseded-1", kind: "refresh-workspace", status: "superseded" }),
    ])).toEqual({ disabled: false, reason: null });
    expect(getLayerActionState("rebuildSdkIndex", [
      task({ taskId: "sdk-1", kind: "sdk", status: "cancelled" }),
    ])).toEqual({ disabled: false, reason: null });
    expect(getLayerActionState("indexCurrentFile", [
      task({
        taskId: "skipped-1",
        kind: "changed-paths",
        status: "skipped",
        reason: "foreground-navigation",
        targetPaths: ["/workspace/src/Entry.ets"],
      }),
    ], "/workspace/src/Entry.ets")).toEqual({ disabled: false, reason: null });
  });

  it("builds repair action evidence from query event payloads", () => {
    const evidence = buildRepairActionEvidence({
      recentEvents: [
        indexEvent({
          eventId: "task-event",
          scope: "task",
          payloadJson: JSON.stringify({ recommendedAction: "rebuildIndex" }),
        }),
        indexEvent({
          eventId: "query-rebuild",
          scope: "query",
          kind: "definition",
          phase: "miss",
          message: "No indexed evidence explains this query yet",
          payloadJson: JSON.stringify({ recommendedAction: "rebuildIndex" }),
          createdAt: 2,
        }),
        indexEvent({
          eventId: "query-sdk",
          scope: "query",
          kind: "completion",
          phase: "blocked",
          message: "SDK API index is not ready",
          payloadJson: JSON.stringify({ recommendedAction: "configureSdk" }),
          createdAt: 3,
        }),
      ],
    });

    expect(evidence).toEqual([
      {
        action: "configureSdk",
        source: "completion blocked",
        detail: "SDK API index is not ready",
      },
      {
        action: "rebuildProjectIndex",
        source: "definition miss",
        detail: "No indexed evidence explains this query yet",
      },
    ]);
  });

  it("builds a copyable diagnostics evidence report", () => {
    const report = buildIndexDiagnosticsEvidenceReport({
      diagnostics: {
        rootPath: "/workspace",
        status: "partial",
        schemaVersions: {},
        schemaVersionActions: [],
        fileCount: 12,
        symbolCount: 34,
        contentLineCount: 56,
        fingerprintCount: 12,
        stubFileCount: 10,
        stubDeclarationCount: 20,
        dependencyEdgeCount: 2,
        unresolvedImportCount: 1,
        parserErrorCount: 2,
        staleGenerationCount: 3,
        sdkSymbolCount: 4,
        discoveryStatus: "running",
        discoveredFileCount: 12,
        discoveryExcludedCount: 1,
        discoveryHasMore: true,
        dbSizeBytes: 2048,
        queuePressure: {
          rootPath: "/workspace",
          pendingTaskCount: 1,
          workspacePendingTaskCount: 1,
          highestPriority: "foreground",
          highestPriorityTaskKind: "changed-paths",
        },
        activeSdkPath: null,
        activeSdkVersion: null,
        lastError: "worker failed",
        lastExplainStatus: "miss",
        retryBackoffCount: 1,
        latestRetryBackoff: "recommended retry delay 2000ms",
        repairActions: ["rebuildProjectIndex"],
        parserFailures: [],
        unresolvedImports: [],
        timeline: [],
        recentEvents: [indexEvent({ scope: "query", kind: "definition", phase: "miss", message: "No target" })],
      },
      activePath: "/workspace/src/Entry.ets",
      fileReadiness: null,
      layerReadiness: {
        rootPath: "/workspace",
        currentFilePath: "/workspace/src/Entry.ets",
        layers: [{
          layer: "symbols",
          workspaceStatus: "partial",
          currentFileStatus: "missing",
          indexedCount: 34,
          failedCount: 2,
          staleCount: 3,
          reason: "symbols stale",
          recommendedAction: "indexCurrentFile",
        }],
      },
      taskStatuses: [task({ kind: "changed-paths", status: "running", progressCurrent: 1, progressTotal: 2 })],
    });

    expect(report).toContain("# ArkLine Index Diagnostics Evidence");
    expect(report).toContain("workspace: /workspace");
    expect(report).toContain("activePath: /workspace/src/Entry.ets");
    expect(report).toContain("status: partial");
    expect(report).toContain("repairActions: rebuildProjectIndex");
    expect(report).toContain("task: changed-paths running 1/2 (50%)");
    expect(report).toContain("layer: symbols workspace=partial current=missing");
    expect(report).toContain("event: query/definition/miss warning No target");
  });
});

function task(overrides: Partial<WorkspaceIndexTaskStatus>): WorkspaceIndexTaskStatus {
  return {
    taskId: "task-1",
    rootPath: "/workspace",
    kind: "background-refresh",
    status: "running",
    reason: "",
    generation: 1,
    progressCurrent: 0,
    progressTotal: 0,
    stalled: false,
    message: "",
    ...overrides,
  };
}

function indexEvent(overrides: Partial<WorkspaceIndexEvent>): WorkspaceIndexEvent {
  return {
    eventId: "event",
    rootPath: "/workspace",
    scope: "query",
    kind: "definition",
    phase: "miss",
    severity: "warning",
    message: "",
    taskId: null,
    generation: null,
    payloadJson: "{}",
    createdAt: 1,
    ...overrides,
  };
}
