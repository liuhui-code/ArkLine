import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";

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
});
