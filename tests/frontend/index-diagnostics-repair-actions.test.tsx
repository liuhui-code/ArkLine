import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter repair actions", () => {
  let scrolledElement: Element | null = null;

  beforeEach(() => {
    scrolledElement = null;
    HTMLElement.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolledElement = this;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("surfaces SDK indexing progress in the active task strip when no project task is active", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithRepairAction("rebuildSdkIndex")}
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
          startedAt: 1_000,
          lastHeartbeatAt: 4_000,
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
    expect(within(activeTask).getByText("SDK index task running")).toBeVisible();
    expect(within(activeTask).getByText("sdk")).toBeVisible();
    expect(within(activeTask).getByText("7/20 (35%)")).toBeVisible();
    expect(within(activeTask).getByText("3.0s active")).toBeVisible();
  });

  it("runs current-file indexing from an index-current-file repair action", () => {
    const onIndexCurrentFile = vi.fn();

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithRepairAction("indexCurrentFile")}
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
        onIndexCurrentFile={onIndexCurrentFile}
      />,
    );

    const repairActions = screen.getByLabelText("Repair Actions");
    fireEvent.click(within(repairActions).getByRole("button", { name: "Index Current File" }));

    expect(onIndexCurrentFile).toHaveBeenCalledTimes(1);
  });

  it("opens parser failures from an inspect-parser-failures repair action", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithRepairAction("inspectParserFailures")}
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

    const repairActions = screen.getByLabelText("Repair Actions");
    fireEvent.click(within(repairActions).getByRole("button", { name: "Inspect Parser Failures" }));

    expect(scrolledElement).toHaveAttribute("id", "index-diagnostics-parser-errors");
  });

  it("opens unresolved imports from an inspect-unresolved-imports repair action", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithRepairAction("inspectUnresolvedImports")}
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

    const repairActions = screen.getByLabelText("Repair Actions");
    fireEvent.click(within(repairActions).getByRole("button", { name: "Inspect Unresolved Imports" }));

    expect(scrolledElement).toHaveAttribute("id", "index-diagnostics-unresolved-imports");
  });

  it("shows query explain evidence for suggested repair actions", () => {
    const diagnostics = diagnosticsWithRepairAction("rebuildProjectIndex");
    diagnostics.recentEvents = [{
      eventId: "query-miss",
      rootPath: "C:/workspace",
      scope: "query",
      kind: "definition",
      phase: "miss",
      severity: "warning",
      message: "No indexed evidence explains this query yet",
      taskId: null,
      generation: 18,
      payloadJson: JSON.stringify({ recommendedAction: "rebuildIndex" }),
      createdAt: 4,
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

    const evidence = screen.getByLabelText("Repair Evidence");
    expect(within(evidence).getByText("Rebuild Project Index")).toBeVisible();
    expect(within(evidence).getByText("definition miss")).toBeVisible();
    expect(within(evidence).getByText("No indexed evidence explains this query yet")).toBeVisible();
  });

  it("shows inspect-index query explain evidence as a repair action", () => {
    const diagnostics = diagnosticsWithRepairAction("rebuildProjectIndex");
    diagnostics.recentEvents = [{
      eventId: "query-blocked",
      rootPath: "C:/workspace",
      scope: "query",
      kind: "textSearch",
      phase: "blocked",
      severity: "warning",
      message: "Text index readiness is blocked",
      taskId: null,
      generation: 18,
      payloadJson: JSON.stringify({ recommendedAction: "inspectIndex" }),
      createdAt: 4,
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

    const evidence = screen.getByLabelText("Repair Evidence");
    expect(within(evidence).getByText("Inspect Index")).toBeVisible();
    expect(within(evidence).getByText("textSearch blocked")).toBeVisible();
    expect(within(evidence).getByText("Text index readiness is blocked")).toBeVisible();
  });

  it("uses query explain action when recommendedAction is absent", () => {
    const diagnostics = diagnosticsWithRepairAction("rebuildProjectIndex");
    diagnostics.recentEvents = [{
      eventId: "query-explain-action",
      rootPath: "C:/workspace",
      scope: "query",
      kind: "completion",
      phase: "blocked",
      severity: "warning",
      message: "Current file symbols are missing",
      taskId: null,
      generation: 18,
      payloadJson: JSON.stringify({ explain: ["query:completion", "action:indexCurrentFile"] }),
      createdAt: 4,
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

    const evidence = screen.getByLabelText("Repair Evidence");
    expect(within(evidence).getByText("Index Current File")).toBeVisible();
    expect(within(evidence).getByText("completion blocked")).toBeVisible();
    expect(within(evidence).getByText("Current file symbols are missing")).toBeVisible();
  });
});

function diagnosticsWithRepairAction(action: string): WorkspaceIndexDiagnostics {
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
      pendingTaskCount: 1,
      workspacePendingTaskCount: 1,
      highestPriority: "foreground",
      highestPriorityTaskKind: "refresh-workspace",
    },
    activeSdkPath: null,
    activeSdkVersion: null,
    lastError: null,
    lastExplainStatus: null,
    retryBackoffCount: 0,
    latestRetryBackoff: null,
    repairActions: [action],
    parserFailures: [],
    unresolvedImports: [],
    timeline: [],
    recentEvents: [],
  };
}
