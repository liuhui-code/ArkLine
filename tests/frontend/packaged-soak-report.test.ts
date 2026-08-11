import { describe, expect, it } from "vitest";
import { summarizeProcessEvidence } from "../../scripts/packaged-soak-process-evidence.mjs";
import { buildPackagedSoakReport } from "../../scripts/packaged-soak-report.mjs";

describe("packaged Windows soak report", () => {
  it("accounts for the complete ArkLine and WebView2 process tree", () => {
    expect(summarizeProcessEvidence([
      {
        ProcessName: "ArkLine",
        WorkingSet64: 100,
        PrivateMemorySize64: 80,
        HandleCount: 10,
        ThreadCount: 4,
      },
      {
        ProcessName: "msedgewebview2",
        WorkingSet64: 200,
        PrivateMemorySize64: 160,
        HandleCount: 20,
        ThreadCount: 8,
      },
    ])).toEqual({
      processCount: 2,
      rssBytes: 300,
      privateBytes: 240,
      handleCount: 30,
      threadCount: 12,
    });
  });

  it("builds a passing versioned report from complete coverage evidence", () => {
    const report = buildPackagedSoakReport({
      options: {
        applicationPath: "C:\\ArkLine.exe",
        fixturePath: "C:\\fixture",
      },
      startedAt: Date.now() - 1_000,
      counters: { crashCount: 0, unresponsiveCount: 0, staleApplyCount: 0 },
      automationDispatchSamples: [5_000],
      searchReadySamples: [80],
      jumpSamples: [90],
      editorInputSamples: [5_000],
      editorScrollSamples: [16],
      diagnostics: [diagnostic(64, 36), diagnostic(100, 0)],
      processSamples: Array.from({ length: 9 }, (_, index) => ({
        processCount: 4,
        rssBytes: 100 + index * 10,
        privateBytes: 80 + index * 5,
        handleCount: 10 + index,
        threadCount: 5,
      })),
      heapSamples: Array.from({ length: 9 }, (_, index) => ({
        supported: true,
        usedBytes: 40 + index * 5,
      })),
      telemetry: telemetry(),
    });

    expect(report.schemaVersion).toBe(7);
    expect(report.indexCoverage).toMatchObject({
      coreReady: true,
      backgroundProgressObserved: true,
    });
    expect(report.telemetry.interactionTraces).toMatchObject({
      count: 3,
      statusCounts: { ok: 3 },
    });
    expect(report.summary).toMatchObject({
      maxProcessCount: 4,
      rssGrowthBytes: 40,
      privateGrowthBytes: 20,
      jsHeapGrowthBytes: 20,
      coldRssGrowthBytes: 80,
      editorAutomationP95Ms: 5_000,
      steadyProcessSampleCount: 5,
      pendingLoads: 0,
    });
    expect(report.verdict.passed).toBe(true);
  });
});

function diagnostic(contentFileCount: number, missingCount: number) {
  return {
    fileCount: 100,
    discoveredFileCount: 100,
    discoveryStatus: "ready",
    contentFileCount,
    freshnessLayers: [{
      layer: "content",
      readyCount: contentFileCount,
      staleCount: 0,
      missingCount,
    }],
    walSizeBytes: contentFileCount,
    sharedSdkWalSizeBytes: contentFileCount,
    workerRestartCount: 0,
  };
}

function telemetry() {
  return {
    capabilities: { eventTiming: true, longAnimationFrame: true },
    errors: [],
    eventTimings: [{
      duration: 20,
      interactionId: 1,
      targetLabel: "Find in Files Query",
    }],
    frameGaps: [],
    longAnimationFrames: [],
    longTasks: [],
    interactionTraces: [
      traceEvidence("editorInput", "input:1", 20),
      traceEvidence("text", "search:1", 80),
      traceEvidence("navigation", "navigation:1", 210),
    ],
    eventTimingCount: 1,
    frames: 60,
  };
}

function traceEvidence(kind: string, id: string, durationMs: number) {
  return {
    id,
    kind,
    label: id,
    startedAt: 100,
    durationMs,
    status: "ok",
    phases: [],
  };
}
