import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IndexDiagnosticsProcessesSection } from "@/components/layout/IndexDiagnosticsProcessesSection";
import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsProcessesSection", () => {
  it("renders bounded live task target paths", () => {
    render(
      <IndexDiagnosticsProcessesSection
        queuePressure={undefined}
        taskStatuses={[task({
          kind: "changed-paths",
          reason: "foreground-navigation",
          targetPaths: [
            "/workspace/src/Entry.ets",
            "/workspace/src/Other.ets",
            "/workspace/features/Search.ets",
          ],
          targetPathCount: 5,
        })]}
      />,
    );

    const processes = screen.getByRole("region", { name: "Processes / Queue" });
    expect(within(processes).getByText("Target")).toBeVisible();
    expect(within(processes).getByText("src/Entry.ets, src/Other.ets, features/Search.ets +2 more")).toBeVisible();
  });
});

function task(overrides: Partial<WorkspaceIndexTaskStatus>): WorkspaceIndexTaskStatus {
  return {
    taskId: "task-1",
    rootPath: "/workspace",
    kind: "refresh-workspace",
    status: "queued",
    reason: "manual",
    generation: 1,
    progressCurrent: 0,
    progressTotal: 1,
    ...overrides,
  };
}
