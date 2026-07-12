import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";

describe("IndexDiagnosticsCenter SDK health", () => {
  it("surfaces active SDK indexing status in Health / Storage", () => {
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
          taskId: "sdk-1",
          rootPath: "C:/workspace",
          kind: "sdk",
          status: "running",
          reason: "settings apply",
          generation: 4,
          progressCurrent: 12,
          progressTotal: 40,
          startedAt: 1_000,
          lastHeartbeatAt: 2_000,
          stalled: true,
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
    const sdkSummary = within(health).getByRole("status", { name: "SDK Index Task Summary" });
    expect(within(sdkSummary).getByText("SDK index task stalled")).toBeVisible();
    expect(within(sdkSummary).getByText("12/40 (30%)")).toBeVisible();
    expect(within(sdkSummary).getByText("settings apply · No heartbeat > 60s")).toBeVisible();
  });
});
