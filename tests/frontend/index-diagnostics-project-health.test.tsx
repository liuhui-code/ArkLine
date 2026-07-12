import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter project health", () => {
  it("surfaces active project indexing status in Health / Storage", () => {
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
          taskId: "project-1",
          rootPath: "C:/workspace",
          kind: "full-refresh",
          status: "running",
          reason: "rebuild project",
          generation: 7,
          progressCurrent: 128,
          progressTotal: 512,
          startedAt: 1_000,
          lastHeartbeatAt: 6_500,
          stalled: false,
        }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const health = screen.getByRole("region", { name: "Health / Storage" });
    const projectSummary = within(health).getByRole("status", { name: "Project Index Task Summary" });
    expect(within(projectSummary).getByText("Project index task running")).toBeVisible();
    expect(within(projectSummary).getByText("128/512 (25%)")).toBeVisible();
    expect(within(projectSummary).getByText("5.5s active")).toBeVisible();
    expect(within(projectSummary).getByText("rebuild project")).toBeVisible();
  });

  it("surfaces retry backoff status in Health / Storage", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={{
          ...diagnostics(),
          retryBackoffCount: 1,
          latestRetryBackoff: "changed-paths failed 2 consecutive time(s); recommended retry delay 2000ms",
        }}
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
    expect(within(health).getByText("Retry backoff")).toBeVisible();
    expect(within(health).getByText(/recommended retry delay 2000ms/)).toBeVisible();
  });
});

function diagnostics(): WorkspaceIndexDiagnostics {
  return {
    rootPath: "C:/workspace",
    status: "ready",
    schemaVersions: {},
    schemaVersionActions: [],
    fileCount: 0,
    symbolCount: 0,
    contentLineCount: 0,
    fingerprintCount: 0,
    stubFileCount: 0,
    stubDeclarationCount: 0,
    dependencyEdgeCount: 0,
    unresolvedImportCount: 0,
    parserErrorCount: 0,
    staleGenerationCount: 0,
    sdkSymbolCount: 0,
    discoveryStatus: null,
    discoveredFileCount: 0,
    discoveryExcludedCount: 0,
    discoveryHasMore: false,
    dbSizeBytes: 0,
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
    recentEvents: [],
    timeline: [],
  };
}
