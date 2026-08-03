import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IndexDiagnosticsSemanticHostSection } from "@/components/layout/IndexDiagnosticsSemanticHostSection";

describe("IndexDiagnosticsSemanticHostSection", () => {
  it("renders bounded semantic provider latency evidence", () => {
    render(<IndexDiagnosticsSemanticHostSection semanticState={{
      provider: "semantic-host",
      mode: "semantic",
      detail: "ready",
      supervisor: {
        status: "running",
        restartCount: 0,
        restoredDocumentCount: 0,
        consecutiveFailures: 0,
        lastHeartbeatEpochMs: null,
        retryAfterMs: 0,
        lastError: null,
        runtime: {
          rssBytes: 100,
          heapUsedBytes: 50,
          heapTotalBytes: 80,
          externalBytes: 1,
          uptimeMs: 5,
          providerLatencies: {
            completion: { count: 12, p50Us: 800, p95Us: 2400, maxUs: 3000 },
          },
        },
        memoryBudgetBytes: 1024,
      },
    }} />);

    const region = screen.getByRole("region", { name: "Semantic Host" });
    expect(within(region).getByText("2.4 ms / 12")).toBeVisible();
    for (const label of [
      "Workspace prepare p95",
      "Type prepare p95",
      "Definition p95",
      "Signature p95",
    ]) {
      const metric = within(region).getByText(label).closest("div");
      expect(metric).not.toBeNull();
      expect(within(metric as HTMLElement).getByText("not sampled")).toBeVisible();
    }
  });
});
