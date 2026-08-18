import { describe, expect, it, vi } from "vitest";

const readiness = vi.hoisted(() => ({
  waitForCoreIndexReady: vi.fn(async () => undefined),
  waitForDiscoveryReady: vi.fn(async () => undefined),
  waitForInteractiveIndexReady: vi.fn(async () => undefined),
  waitForTerminalIndexReady: vi.fn(async () => undefined),
}));
const semantic = vi.hoisted(() => ({
  warmSemanticInteractions: vi.fn(async () => undefined),
}));

vi.mock("../../scripts/packaged-soak-readiness.mjs", () => readiness);
vi.mock("../../scripts/packaged-soak-semantic-workload.mjs", () => semantic);

import { preparePackagedSoakRun } from "../../scripts/packaged-soak-preparation.mjs";

describe("packaged soak preparation", () => {
  it("waits for complete core coverage before warming a real workspace", async () => {
    const phases: string[] = [];
    const options = {
      mode: "smoke",
      fixturePath: "C:/fixtures/real-project",
      coreIndexTimeoutMs: 300_000,
    };

    await preparePackagedSoakRun({}, options, { kind: "real-workspace" }, phases.push.bind(phases));

    expect(readiness.waitForDiscoveryReady).toHaveBeenCalledWith(
      {},
      options.fixturePath,
      180_000,
    );
    expect(readiness.waitForCoreIndexReady).toHaveBeenCalledWith(
      {},
      options.fixturePath,
      options.coreIndexTimeoutMs,
    );
    expect(semantic.warmSemanticInteractions).toHaveBeenCalled();
    expect(readiness.waitForTerminalIndexReady).toHaveBeenCalledWith(
      {},
      options.fixturePath,
      options.coreIndexTimeoutMs,
    );
    expect(phases).toEqual([
      "discovery-ready",
      "core-index-ready",
      "semantic-warmup",
      "terminal-index-ready",
    ]);
  });
});
