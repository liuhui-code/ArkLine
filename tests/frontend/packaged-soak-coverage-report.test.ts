import { describe, expect, it } from "vitest";
import { evaluateSoakReport } from "../../scripts/packaged-soak-model.mjs";
import { summarizeIndexCoverage } from "../../scripts/packaged-soak-report.mjs";

describe("packaged soak coverage report", () => {
  it("preserves layer coverage progress instead of only the final row count", () => {
    expect(summarizeIndexCoverage([
      { capturedAt: 1, fileCount: 10, contentFileCount: 1, stubFileCount: 2, freshnessLayers: [] },
      { capturedAt: 2, fileCount: 10, discoveredFileCount: 10, discoveryStatus: "ready", contentFileCount: 4, stubFileCount: 2, freshnessLayers: [{ layer: "content", readyCount: 4, staleCount: 0, missingCount: 6 }] },
    ])).toMatchObject({ sampleCount: 2, contentAdvanced: true, stubAdvanced: false, coreReady: false });
  });

  it("rejects a soak run whose diagnostics cannot prove content coverage", () => {
    expect(evaluateSoakReport({
      crashCount: 0,
      unresponsiveCount: 0,
      pendingLoads: 0,
      staleApplyCount: 0,
      searchMissCount: 0,
      editorInteractionFailureCount: 0,
      workerRestartGrowth: 0,
      indexedContentFileCount: 10,
      indexedFileCount: 10,
      coreIndexCoverageVerified: false,
      backgroundIndexProgressObserved: false,
      stalledIndexTaskCount: 0,
    }).failures).toEqual(expect.arrayContaining([
      "unverified-content-index-coverage",
      "no-background-index-progress",
    ]));
  });

  it("recognizes complete discovery and content freshness as verified coverage", () => {
    expect(summarizeIndexCoverage([{
      capturedAt: 1,
      fileCount: 10,
      discoveredFileCount: 10,
      discoveryStatus: "ready",
      contentFileCount: 10,
      stubFileCount: 2,
      freshnessLayers: [{ layer: "content", readyCount: 10, staleCount: 0, missingCount: 0 }],
    }]).coreReady).toBe(true);
  });

  it("marks content or stub growth as observed background progress", () => {
    expect(summarizeIndexCoverage([
      { contentFileCount: 1, stubFileCount: 1 },
      { contentFileCount: 1, stubFileCount: 2 },
    ]).backgroundProgressObserved).toBe(true);
  });
});
