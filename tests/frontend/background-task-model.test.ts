import { describe, expect, it } from "vitest";
import { deriveBackgroundTasks } from "@/components/layout/background-task-model";
import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";

describe("background task model", () => {
  it("projects active index work with real progress and omits completed work", () => {
    const tasks = deriveBackgroundTasks([
      indexTask({
        taskId: "refresh-1",
        kind: "refresh-workspace",
        status: "running",
        reason: "manual-rebuild",
        progressCurrent: 42,
        progressTotal: 100,
      }),
      indexTask({ taskId: "ready-1", status: "ready" }),
    ]);

    expect(tasks).toEqual([{
      id: "index:refresh-1",
      title: "Refreshing project index",
      detail: "42 of 100 files",
      status: "running",
      progress: { current: 42, total: 100 },
      cancellable: false,
      source: "index",
    }]);
  });

  it("includes running builds as cancellable indeterminate work", () => {
    expect(deriveBackgroundTasks([], {
      status: "running",
      message: "Building HAP entry debug",
    })).toEqual([{
      id: "build:current",
      title: "Building project",
      detail: "Building HAP entry debug",
      status: "running",
      progress: null,
      cancellable: true,
      source: "build",
    }]);
  });
});

function indexTask(overrides: Partial<WorkspaceIndexTaskStatus> = {}): WorkspaceIndexTaskStatus {
  return {
    taskId: "task-1",
    rootPath: "/workspace",
    kind: "changed-paths",
    status: "running",
    reason: "filesystem-change",
    generation: 1,
    progressCurrent: 0,
    progressTotal: 0,
    ...overrides,
  };
}
