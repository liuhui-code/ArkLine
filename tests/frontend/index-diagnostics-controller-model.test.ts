import { describe, expect, it } from "vitest";
import { workspaceIndexStatusSummary } from "@/components/layout/index-diagnostics-controller-model";
import {
  diagnostics,
  indexState,
  layerReadiness,
  taskStatus,
} from "./index-diagnostics-controller-test-fixtures";

describe("index diagnostics controller model", () => {
  it("shows an active task ahead of a stale ready-layer snapshot", () => {
    const summary = workspaceIndexStatusSummary({
      diagnostics: null,
      healthSummary: null,
      layerReadiness: readyLayers(),
      workspaceIndexState: indexState(),
      taskStatuses: [runningTask()],
    });

    expect(summary.workspaceIndexText).toBe("Index: running project · 0/1 (0%)");
  });

  it("keeps actionable health failures ahead of active progress", () => {
    const summary = workspaceIndexStatusSummary({
      diagnostics: { ...diagnostics(), lastError: "worker crashed" },
      healthSummary: null,
      layerReadiness: readyLayers(),
      workspaceIndexState: indexState(),
      taskStatuses: [runningTask()],
    });

    expect(summary.workspaceIndexText).toBe("Index: Error, worker crashed");
  });
});

function runningTask() {
  return taskStatus({
    taskId: "1:open-workspace",
    kind: "open-workspace",
    status: "running",
    reason: "open-workspace",
    progressCurrent: 0,
    progressTotal: 1,
  });
}

function readyLayers() {
  const report = layerReadiness();
  return {
    ...report,
    layers: report.layers.map((layer) => ({
      ...layer,
      workspaceStatus: "ready" as const,
      currentFileStatus: "ready" as const,
      failedCount: 0,
      staleCount: 0,
    })),
  };
}
