import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexLayerReadinessReport } from "@/features/workspace/workspace-api";

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
});

function layerReadiness(): WorkspaceIndexLayerReadinessReport {
  return {
    rootPath: "/workspace",
    currentFilePath: "/workspace/Entry.ets",
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
