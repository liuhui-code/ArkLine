import { describe, expect, it } from "vitest";
import { createIpcLatencyStore } from "@/features/performance/ipc-latency-store";

describe("ipc latency store", () => {
  it("retains causal interaction ids alongside request generations", () => {
    const store = createIpcLatencyStore(2);
    store.record({
      command: "open_text_document",
      durationMs: 18,
      startedAt: 100,
      status: "ok",
      interactionId: "navigation:7",
    });
    store.record({
      command: "query_workspace_candidates",
      durationMs: 24,
      startedAt: 120,
      status: "ok",
      generation: 9,
    });

    expect(store.snapshot()).toEqual([
      expect.objectContaining({ command: "query_workspace_candidates", generation: 9 }),
      expect.objectContaining({ command: "open_text_document", interactionId: "navigation:7" }),
    ]);
  });
});
