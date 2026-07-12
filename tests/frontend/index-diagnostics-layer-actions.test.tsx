import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexLayerReadinessReport } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter layer actions", () => {
  it("runs supported layer actions from the layer table", () => {
    const onRebuildProjectIndex = vi.fn();
    const onConfigureSdk = vi.fn();
    const onIndexCurrentFile = vi.fn();

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="/workspace/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={layerReadiness()}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={onRebuildProjectIndex}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={onConfigureSdk}
        onIndexCurrentFile={onIndexCurrentFile}
      />,
    );

    const layers = screen.getByRole("region", { name: "Index Layers" });
    fireEvent.click(within(layers).getByRole("button", { name: "Rebuild Project Index" }));
    fireEvent.click(within(layers).getByRole("button", { name: "Configure SDK" }));
    fireEvent.click(within(layers).getByRole("button", { name: "Index Current File" }));

    expect(onRebuildProjectIndex).toHaveBeenCalledTimes(1);
    expect(onConfigureSdk).toHaveBeenCalledTimes(1);
    expect(onIndexCurrentFile).toHaveBeenCalledTimes(1);
    expect(within(layers).getByText("Wait for Index")).toBeVisible();
    expect(within(layers).queryByRole("button", { name: "Wait for Index" })).toBeNull();
  });

  it("disables current file indexing while foreground navigation indexing is active", () => {
    const onIndexCurrentFile = vi.fn();

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="/workspace/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={layerReadiness("c:/workspace/src/Entry.ets")}
        recentQueryExplains={[]}
        taskStatuses={[{ ...taskStatus("changed-paths", "running"), reason: "foreground-navigation" }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
        onIndexCurrentFile={onIndexCurrentFile}
      />,
    );

    const layers = screen.getByRole("region", { name: "Index Layers" });
    const action = within(layers).getByRole("button", { name: "Index Current File" });
    expect(action).toBeDisabled();
    expect(within(layers).getByText("Foreground navigation indexing is already active: running 2/8 (25%)")).toBeVisible();

    fireEvent.click(action);

    expect(onIndexCurrentFile).not.toHaveBeenCalled();
  });

  it("keeps current file indexing enabled when foreground navigation targets another file", () => {
    const onIndexCurrentFile = vi.fn();

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="/workspace/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={layerReadiness()}
        recentQueryExplains={[]}
        taskStatuses={[{
          ...taskStatus("changed-paths", "running"),
          reason: "foreground-navigation",
          targetPaths: ["/workspace/Other.ets"],
          targetPathCount: 1,
        }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
        onIndexCurrentFile={onIndexCurrentFile}
      />,
    );

    const layers = screen.getByRole("region", { name: "Index Layers" });
    const action = within(layers).getByRole("button", { name: "Index Current File" });
    expect(action).toBeEnabled();

    fireEvent.click(action);

    expect(onIndexCurrentFile).toHaveBeenCalledTimes(1);
  });

  it("normalizes target paths before disabling current file indexing", () => {
    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="c:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={null}
        fileReadiness={null}
        layerReadiness={layerReadiness("c:/workspace/src/Entry.ets")}
        recentQueryExplains={[]}
        taskStatuses={[{
          ...taskStatus("changed-paths", "running"),
          reason: "foreground-navigation",
          targetPaths: ["C:\\workspace\\src\\Entry.ets"],
          targetPathCount: 1,
        }]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
        onIndexCurrentFile={vi.fn()}
      />,
    );

    const layers = screen.getByRole("region", { name: "Index Layers" });
    expect(within(layers).getByRole("button", { name: "Index Current File" })).toBeDisabled();
  });
});

function layerReadiness(currentFilePath = "/workspace/Entry.ets"): WorkspaceIndexLayerReadinessReport {
  return {
    rootPath: "/workspace",
    currentFilePath,
    layers: [
      layer("projectFile", "rebuildIndex"),
      layer("sdkApi", "configureSdk"),
      layer("symbols", "indexCurrentFile"),
      layer("projectDeep", "wait"),
    ],
  };
}

function layer(layerName: string, recommendedAction: string) {
  return {
    layer: layerName,
    workspaceStatus: "partial",
    currentFileStatus: "missing",
    indexedCount: 1,
    failedCount: 0,
    staleCount: 0,
    reason: `${layerName} needs attention.`,
    recommendedAction,
  };
}

function taskStatus(kind: string, status: WorkspaceIndexTaskStatus["status"]): WorkspaceIndexTaskStatus {
  return {
    taskId: `${kind}-1`,
    rootPath: "/workspace",
    kind,
    status,
    reason: "test",
    generation: 1,
    progressCurrent: 2,
    progressTotal: 8,
  };
}
