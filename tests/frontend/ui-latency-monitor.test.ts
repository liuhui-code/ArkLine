import { describe, expect, it } from "vitest";
import { createUiLatencyMonitor } from "@/features/performance/ui-latency-monitor";

describe("createUiLatencyMonitor", () => {
  it("records event loop lag when a heartbeat exceeds the threshold", () => {
    const monitor = createUiLatencyMonitor({
      lagThresholdMs: 100,
      heartbeatIntervalMs: 50,
      retainedSamples: 20,
    });

    monitor.recordHeartbeat(1_000);
    monitor.recordHeartbeat(1_170);

    expect(monitor.getSnapshot().eventLoopLags).toEqual([
      {
        kind: "eventLoopLag",
        startedAt: 1_050,
        durationMs: 120,
        label: "main-thread",
      },
    ]);
  });

  it("keeps only the newest retained samples", () => {
    const monitor = createUiLatencyMonitor({ retainedSamples: 20 });

    for (let index = 0; index < 25; index += 1) {
      monitor.recordInteraction("globalSearch", `query-${index}`, index * 10, index * 10 + 5);
    }

    const interactions = monitor.getSnapshot().interactions;
    expect(interactions).toHaveLength(20);
    expect(interactions[0]?.label).toBe("query-5");
    expect(interactions[19]?.label).toBe("query-24");
  });

  it("records interaction latency evidence", () => {
    const monitor = createUiLatencyMonitor();

    monitor.recordInteraction("openFile", "EntryAbility.ets", 2_000, 2_245);

    expect(monitor.getSnapshot().interactions).toEqual([
      {
        kind: "openFile",
        startedAt: 2_000,
        durationMs: 245,
        label: "EntryAbility.ets",
      },
    ]);
  });
});
