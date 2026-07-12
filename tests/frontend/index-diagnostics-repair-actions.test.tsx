import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter repair actions", () => {
  it("disables project rebuild while a project index task is active", () => {
    const diagnostics = diagnosticsWithRepairAction("rebuildProjectIndex");
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
        taskStatuses={[{
          taskId: "rebuild-1",
          rootPath: "C:/workspace",
          kind: "refresh-workspace",
          status: "running",
          reason: "diagnostics rebuild",
          generation: 3,
          progressCurrent: 42,
          progressTotal: 100,
        }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={onRebuildProjectIndex}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const repairActions = screen.getByLabelText("Repair Actions");
    const button = within(repairActions).getByRole("button", { name: "Running Project Index" });
    expect(button).toBeDisabled();
    expect(within(repairActions).getByText("42/100 (42%)")).toBeVisible();

    fireEvent.click(button);

    expect(onRebuildProjectIndex).not.toHaveBeenCalled();
  });

  it("disables SDK rebuild while an SDK index task is active", () => {
    const diagnostics = diagnosticsWithRepairAction("rebuildSdkIndex");
    const onRebuildSdkIndex = vi.fn();

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
        taskStatuses={[{
          taskId: "sdk-1",
          rootPath: "C:/workspace",
          kind: "sdk",
          status: "running",
          reason: "settings apply",
          generation: 3,
          progressCurrent: 7,
          progressTotal: 20,
        }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={onRebuildSdkIndex}
        onConfigureSdk={vi.fn()}
      />,
    );

    const repairActions = screen.getByLabelText("Repair Actions");
    const button = within(repairActions).getByRole("button", { name: "Running SDK Index" });
    expect(button).toBeDisabled();
    expect(within(repairActions).getByText("7/20 (35%)")).toBeVisible();

    fireEvent.click(button);

    expect(onRebuildSdkIndex).not.toHaveBeenCalled();
  });
});

function diagnosticsWithRepairAction(action: string): WorkspaceIndexDiagnostics {
  return {
    rootPath: "C:/workspace",
    status: "partial",
    schemaVersions: {},
    schemaVersionActions: [],
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
      pendingTaskCount: 1,
      workspacePendingTaskCount: 1,
      highestPriority: "foreground",
      highestPriorityTaskKind: "refresh-workspace",
    },
    activeSdkPath: null,
    activeSdkVersion: null,
    lastError: null,
    lastExplainStatus: null,
    repairActions: [action],
    parserFailures: [],
    unresolvedImports: [],
    timeline: [],
    recentEvents: [],
  };
}
