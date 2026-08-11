import { describe, expect, it } from "vitest";
import { summarizeProcessEvidence } from "../../scripts/packaged-soak-process-evidence.mjs";
import { summarizeProcessAttribution } from "../../scripts/packaged-soak-process-attribution.mjs";
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

  it("attributes stable memory growth to renderer and semantic worker roles", () => {
    const samples = Array.from({ length: 9 }, (_, index) => ({
      capturedAt: index,
      processes: [
        { ProcessName: "msedgewebview2", CommandLine: "--type=renderer", WorkingSet64: 100 + index, PrivateMemorySize64: 200 + index * 2 },
        { ProcessName: "arkline-semantic", CommandLine: "", WorkingSet64: 50 + index, PrivateMemorySize64: 80 + index * 3 },
      ],
    }));
    expect(summarizeProcessAttribution(samples)).toMatchObject({
      renderer: { sampleCount: 9, privateGrowthBytes: 8 },
      semanticWorker: { sampleCount: 9, privateGrowthBytes: 12 },
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
      diagnostics: [
        diagnostic(64, 36, { rssBytes: 128, heapUsedBytes: 80 }),
        diagnostic(100, 0, { rssBytes: 256, heapUsedBytes: 160 }),
      ],
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
      rendererSamples: Array.from({ length: 9 }, (_, index) => ({
        supported: true,
        usedBytes: 20 + index * 4,
        domNodeCount: 100 + index,
        renderPressure: { counts: { AppShell: 10 + index * 2 } },
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
      rendererJsHeapGrowthBytes: 16,
      rendererDomNodeGrowth: 8,
      rendererRenderGrowth: 16,
      coldRssGrowthBytes: 80,
      editorAutomationP95Ms: 5_000,
      steadyProcessSampleCount: 5,
      pendingLoads: 0,
    });
    expect(report.verdict.passed).toBe(true);
    expect(report.semanticRuntime).toMatchObject({
      sampleCount: 2,
      last: { rssBytes: 256, heapUsedBytes: 160 },
    });
  });
});

function diagnostic(contentFileCount: number, missingCount: number, semanticRuntime = null) {
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
    semanticRuntime,
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
