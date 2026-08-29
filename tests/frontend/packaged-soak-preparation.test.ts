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
const search = vi.hoisted(() => ({
  verifySearchEverywhereClass: vi.fn(async () => undefined),
}));

vi.mock("../../scripts/packaged-soak-readiness.mjs", () => readiness);
vi.mock("../../scripts/packaged-soak-semantic-workload.mjs", () => semantic);
vi.mock("../../scripts/packaged-soak-search-workload.mjs", () => search);

import { preparePackagedSoakRun } from "../../scripts/packaged-soak-preparation.mjs";

describe("packaged soak preparation", () => {
  it("proves Double Shift class search before generated smoke waits for full indexing", async () => {
    const phases: string[] = [];
    const options = {
      mode: "smoke",
      fixturePath: "C:/fixtures/generated-project",
      coreIndexTimeoutMs: 300_000,
    };

    await preparePackagedSoakRun({}, options, { kind: "generated" }, phases.push.bind(phases));

    expect(readiness.waitForDiscoveryReady).toHaveBeenCalledWith(
      {},
      options.fixturePath,
      90_000,
    );
    expect(readiness.waitForInteractiveIndexReady).not.toHaveBeenCalled();
    expect(search.verifySearchEverywhereClass).toHaveBeenCalledWith({}, "Page000000");
    expect(phases).toEqual([
      "discovery-ready",
      "search-everywhere-class-ready",
      "semantic-warmup",
    ]);
  });

  it("waits for complete core coverage before warming a real workspace", async () => {
    const phases: string[] = [];
    const options = {
      mode: "smoke",
      fixturePath: "C:/fixtures/real-project",
      coreIndexTimeoutMs: 300_000,
    };

    await preparePackagedSoakRun({}, options, {
      kind: "real-workspace",
      searchEverywhereClass: "EntryViewModel",
    }, phases.push.bind(phases));

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
    expect(search.verifySearchEverywhereClass).toHaveBeenCalledWith({}, "EntryViewModel");
    expect(semantic.warmSemanticInteractions).toHaveBeenCalled();
    expect(readiness.waitForTerminalIndexReady).toHaveBeenCalledWith(
      {},
      options.fixturePath,
      options.coreIndexTimeoutMs,
    );
    expect(phases).toEqual([
      "discovery-ready",
      "core-index-ready",
      "search-everywhere-class-ready",
      "semantic-warmup",
      "terminal-index-ready",
    ]);
  });
});
