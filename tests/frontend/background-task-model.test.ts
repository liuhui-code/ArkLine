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

  it("does not present a lifecycle placeholder as measurable zero percent progress", () => {
    const tasks = deriveBackgroundTasks([
      indexTask({
        taskId: "refresh-running",
        kind: "refresh-workspace",
        status: "running",
        reason: "background-refresh-after-open",
        progressCurrent: 0,
        progressTotal: 1,
      }),
    ]);

    expect(tasks[0]).toMatchObject({
      id: "index:refresh-running",
      status: "running",
      progress: null,
      detail: "background-refresh-after-open",
    });
  });

  it("labels deep-index pipeline progress as indexing steps", () => {
    const tasks = deriveBackgroundTasks([
      indexTask({
        taskId: "deep-running",
        kind: "changed-paths",
        status: "running",
        reason: "full-refresh-deep:refresh-workspace",
        progressCurrent: 2,
        progressTotal: 6,
      }),
    ]);

    expect(tasks[0]).toMatchObject({
      progress: { current: 2, total: 6 },
      detail: "2 of 6 indexing steps",
    });
  });

  it("does not resurrect an interrupted discovery after a newer generation is ready", () => {
    const tasks = deriveBackgroundTasks([
      indexTask({
        taskId: "7:discovery",
        kind: "discovery",
        status: "partial",
        reason: "workspace-discovery",
        generation: 7,
      }),
      indexTask({
        taskId: "8:discovery",
        kind: "discovery",
        status: "ready",
        reason: "workspace-discovery",
        generation: 8,
      }),
    ]);

    expect(tasks).toEqual([]);
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
