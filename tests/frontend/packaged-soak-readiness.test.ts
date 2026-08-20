import { describe, expect, it } from "vitest";
import {
  isCoreWorkspaceIndexReady,
  isInteractiveWorkspaceIndexReady,
  isTerminalWorkspaceIndexReady,
  waitForTerminalIndexReady,
} from "../../scripts/packaged-soak-readiness.mjs";

describe("packaged soak index readiness", () => {
  it("accepts complete workspace content readiness when optional layers stay partial", () => {
    expect(isCoreWorkspaceIndexReady({
      status: "partial",
      discoveryStatus: "ready",
      discoveredFileCount: 1_001,
      fileCount: 1_001,
      contentLineCount: 68_270,
      freshnessLayers: [
        {
          layer: "content",
          readyCount: 1_001,
          missingCount: 0,
          staleCount: 0,
        },
      ],
      layerReadiness: {
        layers: [
          {
            layer: "content",
            indexedCount: 1_001,
            workspaceStatus: "ready",
          },
          {
            layer: "sdkApi",
            indexedCount: 0,
            workspaceStatus: "missing",
          },
        ],
      },
    })).toBe(true);
  });

  it("accepts policy-skipped files when indexed content covers all eligible files", () => {
    expect(isCoreWorkspaceIndexReady({
      discoveryStatus: "ready",
      discoveredFileCount: 870,
      fileCount: 870,
      contentLineCount: 55_802,
      freshnessLayers: [{
        layer: "content",
        readyCount: 870,
        missingCount: 0,
        staleCount: 0,
        skippedCount: 18,
      }],
      layerReadiness: {
        layers: [{ layer: "content", indexedCount: 852 }],
      },
    })).toBe(true);
  });

  it("rejects incomplete or stale content freshness", () => {
    const base = {
      status: "partial",
      discoveryStatus: "ready",
      discoveredFileCount: 1_001,
      fileCount: 1_001,
      contentLineCount: 68_270,
      layerReadiness: {
        layers: [{ layer: "content", indexedCount: 1_001 }],
      },
    };

    expect(isCoreWorkspaceIndexReady({
      ...base,
      freshnessLayers: [{
        layer: "content",
        readyCount: 1_000,
        missingCount: 1,
        staleCount: 0,
      }],
    })).toBe(false);
    expect(isCoreWorkspaceIndexReady({
      ...base,
      freshnessLayers: [{
        layer: "content",
        readyCount: 1_001,
        missingCount: 0,
        staleCount: 1,
      }],
    })).toBe(false);
  });

  it("rejects disagreement between freshness and published content rows", () => {
    expect(isCoreWorkspaceIndexReady({
      discoveryStatus: "ready",
      discoveredFileCount: 1_001,
      fileCount: 1_001,
      contentLineCount: 8_240,
      freshnessLayers: [{
        layer: "content",
        readyCount: 1_001,
        missingCount: 0,
        staleCount: 0,
      }],
      layerReadiness: {
        layers: [{ layer: "content", indexedCount: 128 }],
      },
    })).toBe(false);
  });

  it("allows interaction when the target file is ready during background indexing", () => {
    const partialWorkspace = {
      discoveryStatus: "ready",
      discoveredFileCount: 20_001,
      fileCount: 20_001,
      layerReadiness: {
        layers: [{
          layer: "content",
          indexedCount: 128,
          currentFileStatus: "ready",
        }],
      },
    };

    expect(isInteractiveWorkspaceIndexReady(partialWorkspace)).toBe(true);
    expect(isInteractiveWorkspaceIndexReady({
      ...partialWorkspace,
      layerReadiness: {
        layers: [{
          layer: "content",
          indexedCount: 128,
          currentFileStatus: "missing",
        }],
      },
    })).toBe(false);
  });

  it("requires the published workspace state and queue to reach a terminal state", () => {
    const ready = {
      workspaceState: { status: "ready", partialReason: null },
      queuePressure: { workspacePendingTaskCount: 0 },
    };

    expect(isTerminalWorkspaceIndexReady(ready)).toBe(true);
    expect(isTerminalWorkspaceIndexReady({
      ...ready,
      workspaceState: { status: "partial", partialReason: "Background indexing is pending" },
    })).toBe(false);
    expect(isTerminalWorkspaceIndexReady({
      ...ready,
      queuePressure: { workspacePendingTaskCount: 1 },
    })).toBe(false);
  });

  it("uses a lightweight probe while waiting for terminal index readiness", async () => {
    const calls: unknown[][] = [];
    const driver = {
      async executeAsync(...args: unknown[]) {
        calls.push(args);
        return {
          ok: true,
          value: {
            workspaceState: { status: "ready", partialReason: null },
            queuePressure: { workspacePendingTaskCount: 0 },
          },
        };
      },
    };

    await waitForTerminalIndexReady(driver, "/workspace", 1_000);

    const [script, args] = calls[0] as [string, string[]];
    expect(script).toContain("get_workspace_index_state");
    expect(script).toContain("get_workspace_index_task_statuses");
    expect(script).not.toContain("inspect_workspace_index");
    expect(args).toEqual(["/workspace"]);
  });

  it("retries a transient aborted readiness probe within the overall deadline", async () => {
    const abortError = Object.assign(new Error("This operation was aborted"), {
      name: "AbortError",
    });
    let callCount = 0;
    const driver = {
      async executeAsync() {
        callCount += 1;
        if (callCount === 1) throw abortError;
        return {
          ok: true,
          value: {
            workspaceState: { status: "ready", partialReason: null },
            queuePressure: { workspacePendingTaskCount: 0 },
          },
        };
      },
    };

    await waitForTerminalIndexReady(driver, "/workspace", 1_000);

    expect(callCount).toBe(2);
  });
});
