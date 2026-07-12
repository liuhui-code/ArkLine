import { describe, expect, it } from "vitest";
import {
  buildIndexDiagnosticsViewModel,
  formatRepairAction,
  formatTaskDuration,
} from "@/components/layout/index-diagnostics-model";
import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";

describe("index diagnostics model", () => {
  it("builds header, storage, and timeline summary text", () => {
    const model = buildIndexDiagnosticsViewModel({
      diagnostics: {
        status: "partial",
        fileCount: 1234,
        dbSizeBytes: 2_621_440,
        timelineCount: 2,
      },
      layerStatusText: null,
      uiLatencyCount: 1,
      ipcLatencyCount: 2,
      renderPressureCount: 3,
    });

    expect(model.headerStatusText).toBe("partial · 1,234 files");
    expect(model.dbSize).toBe("2.5 MB");
    expect(model.timelineCount).toBe(8);
  });

  it("prefers layer readiness status in the header", () => {
    const model = buildIndexDiagnosticsViewModel({
      diagnostics: null,
      layerStatusText: "Index: Ready",
      uiLatencyCount: 0,
      ipcLatencyCount: 0,
      renderPressureCount: 0,
    });

    expect(model.headerStatusText).toBe("Index: Ready");
    expect(model.dbSize).toBe("0 KB");
    expect(model.timelineCount).toBe(0);
  });

  it("formats task duration and repair actions", () => {
    expect(formatTaskDuration(task({ startedAt: 1_000, finishedAt: 2_250 }))).toBe("1.3s total");
    expect(formatTaskDuration(task({ startedAt: 1_000, lastHeartbeatAt: 61_500 }))).toBe("1m 0s active");
    expect(formatRepairAction("inspectParserFailures")).toBe("Inspect Parser Failures");
  });
});

function task(overrides: Partial<WorkspaceIndexTaskStatus>): WorkspaceIndexTaskStatus {
  return {
    taskId: "task-1",
    rootPath: "/workspace",
    kind: "background-refresh",
    status: "running",
    reason: "",
    generation: 1,
    progressCurrent: 0,
    progressTotal: 0,
    stalled: false,
    message: "",
    ...overrides,
  };
}
