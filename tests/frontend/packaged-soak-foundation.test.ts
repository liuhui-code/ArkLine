import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFixtureRelativePath,
  parseFixtureArguments,
  PROFILE_FILE_COUNTS,
  renderFixtureSource,
} from "../../scripts/generate-performance-fixture.mjs";
import {
  evaluateSoakReport,
  evaluateSmokeReport,
  parsePackagedSoakArguments,
  summarizeSamples,
} from "../../scripts/packaged-soak-model.mjs";
import { inspectPackagedSoakPreflight } from "../../scripts/packaged-soak-preflight.mjs";
import {
  TELEMETRY_INSTALL_SCRIPT,
  telemetryDurations,
} from "../../scripts/packaged-soak-telemetry.mjs";
import {
  summarizeProcessEvidence,
  WINDOWS_PROCESS_TREE_SCRIPT,
} from "../../scripts/packaged-soak-process-evidence.mjs";
import {
  buildPackagedSoakFailureReport,
  buildPackagedSoakReport,
} from "../../scripts/packaged-soak-report.mjs";
import {
  SEARCH_UI_EVIDENCE_SCRIPT,
  shouldRecordSearchEvidence,
} from "../../scripts/packaged-soak-search-evidence.mjs";

describe("packaged Windows soak foundation", () => {
  it("defines deterministic 1k, 20k, and 100k ArkTS fixture profiles", () => {
    expect(PROFILE_FILE_COUNTS).toEqual({
      small: 1_000,
      medium: 20_000,
      huge: 100_000,
    });
    expect(buildFixtureRelativePath(12)).toBe("module-012/src/main/ets/Page000012.ets");
    expect(renderFixtureSource(12)).toContain("export class Page000012");
    expect(renderFixtureSource(12)).toContain("arklineSearchNeedle12");
  });

  it("parses explicit fixture output and profile arguments", () => {
    expect(parseFixtureArguments([
      "--profile=medium",
      "--output=C:\\fixtures\\arkline-medium",
    ])).toMatchObject({
      profile: "medium",
      fileCount: 20_000,
      outputPath: "C:\\fixtures\\arkline-medium",
    });
    expect(() => parseFixtureArguments(["--profile=unknown"])).toThrow(
      "Unknown fixture profile",
    );
  });

  it("parses a strict 30 minute packaged run without accepting zero duration", () => {
    expect(parsePackagedSoakArguments([
      "--application=C:\\ArkLine\\arkline.exe",
      "--fixture=C:\\fixtures\\arkline-medium",
      "--duration-minutes=30",
      "--report=artifacts\\packaged-soak.json",
      "--strict",
    ])).toMatchObject({
      durationMs: 30 * 60_000,
      strict: true,
    });
    expect(() => parsePackagedSoakArguments([
      "--application=arkline.exe",
      "--fixture=fixture",
      "--duration-minutes=0",
    ])).toThrow("duration-minutes");
    expect(parsePackagedSoakArguments([
      "--application=arkline.exe",
      "--fixture=fixture",
      "--mode=smoke",
    ])).toMatchObject({
      mode: "smoke",
      durationMs: 2 * 60_000,
      maxCycles: 1,
    });
    expect(() => parsePackagedSoakArguments([
      "--application=arkline.exe",
      "--fixture=fixture",
      "--mode=unknown",
    ])).toThrow("mode");
  });

  it("gates renderer evidence while keeping automation transport diagnostic", () => {
    expect(summarizeSamples([1, 2, 3, 4, 100])).toEqual({
      count: 5,
      p50Ms: 3,
      p95Ms: 100,
      p99Ms: 100,
      maxMs: 100,
    });

    const result = evaluateSoakReport(passingSoakMetrics());
    expect(result.passed).toBe(true);

    expect(evaluateSoakReport(passingSoakMetrics({
      crashCount: 1,
    }))).toMatchObject({
      passed: false,
      failures: expect.arrayContaining(["app-or-editor-crash"]),
    });

    expect(evaluateSoakReport(passingSoakMetrics({
      successfulSearchCount: 0,
      successfulJumpCount: 0,
    }))).toMatchObject({
      passed: false,
      failures: expect.arrayContaining(["no-search-result", "no-navigation"]),
    });

    expect(evaluateSoakReport(passingSoakMetrics({
      searchMissCount: 1,
      indexedContentFileCount: 999,
      stalledIndexTaskCount: 1,
    }))).toMatchObject({
      passed: false,
      failures: expect.arrayContaining([
        "search-result-miss",
        "incomplete-content-index",
        "stalled-index-task",
      ]),
    });

    expect(evaluateSoakReport(passingSoakMetrics({
      eventTimingSupported: false,
      longAnimationFrameSupported: false,
      interactionTimingCount: 0,
      processTreeSampleCount: 0,
      steadyProcessSampleCount: 0,
    }))).toMatchObject({
      passed: false,
      failures: expect.arrayContaining([
        "missing-event-timing",
        "missing-long-animation-frame",
        "no-interaction-timing-evidence",
        "no-process-tree-evidence",
        "insufficient-steady-memory-evidence",
      ]),
    });

    expect(evaluateSoakReport(passingSoakMetrics({
      rendererSearchP95Ms: 301,
      rendererJumpP95Ms: 301,
      interactionTimingP95Ms: 101,
    }))).toMatchObject({
      failures: expect.arrayContaining([
        "renderer-search-p95",
        "renderer-jump-p95",
        "interaction-timing-p95",
      ]),
    });
  });

  it("keeps WebView telemetry bounded and separates frame blocking evidence", () => {
    expect(TELEMETRY_INSTALL_SCRIPT).toContain('supported.has("event")');
    expect(TELEMETRY_INSTALL_SCRIPT).toContain(
      'supported.has("long-animation-frame")',
    );
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("items.length < limit");
    expect(TELEMETRY_INSTALL_SCRIPT).toContain('addEventListener("beforeinput"');
    expect(TELEMETRY_INSTALL_SCRIPT).toContain('event.key === "Enter"');
    expect(telemetryDurations({
      eventTimings: [
        { duration: 18, interactionId: 0 },
        { duration: 42, interactionId: 7, targetLabel: "Find in Files Query" },
        { duration: 30, interactionId: 7, targetLabel: "Find in Files Query" },
        { duration: 24, interactionId: 8, targetLabel: "Quick Open Query" },
        { duration: 80, interactionId: 9, targetLabel: "Unrelated" },
      ],
      longAnimationFrames: [
        { duration: 80, blockingDuration: 12 },
        { duration: 120, blockingDuration: 40 },
      ],
    })).toEqual({
      eventTimings: [18, 42, 30, 24, 80],
      interactionTimings: [42, 24],
      longAnimationFrames: [80, 120],
      longAnimationFrameBlocking: [12, 40],
    });
  });

  it("keeps smoke focused on protocol evidence instead of soak stability", () => {
    expect(evaluateSmokeReport({
      crashCount: 0,
      unresponsiveCount: 0,
      staleApplyCount: 0,
      successfulSearchCount: 1,
      successfulJumpCount: 1,
      eventTimingSupported: true,
      longAnimationFrameSupported: true,
      processTreeSampleCount: 1,
    })).toMatchObject({ passed: true, failures: [] });

    expect(evaluateSmokeReport({
      crashCount: 0,
      unresponsiveCount: 0,
      staleApplyCount: 0,
      successfulSearchCount: 0,
      successfulJumpCount: 0,
      eventTimingSupported: false,
      longAnimationFrameSupported: false,
      processTreeSampleCount: 0,
    })).toMatchObject({
      passed: false,
      failures: expect.arrayContaining([
        "no-search-result",
        "no-navigation",
        "missing-event-timing",
        "missing-long-animation-frame",
        "no-process-tree-evidence",
      ]),
    });
  });

  it("captures bounded query UI evidence for native smoke failures", () => {
    expect(SEARCH_UI_EVIDENCE_SCRIPT).toContain("inputValue");
    expect(SEARCH_UI_EVIDENCE_SCRIPT).toContain("resultCount");
    expect(shouldRecordSearchEvidence(
      { phase: "quick-open-miss", resultCount: 0 },
      0,
    )).toBe(true);
    expect(shouldRecordSearchEvidence(
      { phase: "quick-open-typed", resultCount: 0 },
      40,
    )).toBe(false);
    expect(shouldRecordSearchEvidence(
      { phase: "quick-open-enter-failed", resultCount: 0 },
      0,
    )).toBe(true);
  });

  it("preflights the executable, fixture probes, and Windows runtime tools", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-soak-"));
    try {
      const applicationPath = path.join(root, "ArkLine.exe");
      const fixturePath = path.join(root, "fixture");
      await writeFile(applicationPath, "portable");
      await mkdir(fixturePath);
      await writeFile(
        path.join(fixturePath, ".arkline-performance-fixture.json"),
        JSON.stringify({ version: 1, profile: "small", fileCount: 1_000 }),
      );
      for (const index of [0, 999]) {
        const relativePath = buildFixtureRelativePath(index);
        await mkdir(path.dirname(path.join(fixturePath, relativePath)), {
          recursive: true,
        });
        await writeFile(path.join(fixturePath, relativePath), renderFixtureSource(index));
      }

      const result = await inspectPackagedSoakPreflight({
        applicationPath,
        fixturePath,
        driverPath: "msedgedriver",
      }, async (tool: string) => `C:\\tools\\${tool}.exe`);

      expect(result.passed).toBe(true);
      expect(result.checks.map((check: { name: string }) => check.name)).toEqual([
        "application",
        "fixture-marker",
        "fixture-first-file",
        "fixture-last-file",
        "msedgedriver",
        "powershell",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds an uploadable failure report before a WebDriver session exists", () => {
    const report = buildPackagedSoakFailureReport({
      options: {
        mode: "smoke",
        applicationPath: "C:\\ArkLine.exe",
        fixturePath: "C:\\fixture",
      },
      startedAt: 100,
      failedAt: 200,
      phase: "driver-start",
      error: new Error("driver exited"),
      preflight: { passed: true, checks: [] },
    });

    expect(report).toMatchObject({
      schemaVersion: 3,
      mode: "smoke",
      durationMs: 100,
      fatalError: {
        phase: "driver-start",
        message: "driver exited",
      },
      verdict: {
        passed: false,
        failures: ["harness-failure"],
      },
    });
  });

  it("accounts for the complete ArkLine and WebView2 process tree", () => {
    expect(WINDOWS_PROCESS_TREE_SCRIPT).toContain("ParentProcessId");
    expect(WINDOWS_PROCESS_TREE_SCRIPT).toContain(
      "ARKLINE_SOAK_APPLICATION_PATH",
    );
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

  it("builds a versioned report from renderer, storage, and process evidence", () => {
    const report = buildPackagedSoakReport({
      options: {
        applicationPath: "C:\\ArkLine.exe",
        fixturePath: "C:\\fixture",
      },
      startedAt: Date.now() - 1_000,
      counters: {
        crashCount: 0,
        unresponsiveCount: 0,
        staleApplyCount: 0,
      },
      automationDispatchSamples: [5_000],
      searchReadySamples: [80],
      jumpSamples: [90],
      diagnostics: [
        { walSizeBytes: 100, sharedSdkWalSizeBytes: 20, workerRestartCount: 0 },
        {
          walSizeBytes: 120,
          sharedSdkWalSizeBytes: 30,
          workerRestartCount: 0,
          queuePending: 0,
        },
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
      telemetry: {
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
        eventTimingCount: 1,
        frames: 60,
      },
    });

    expect(report.schemaVersion).toBe(3);
    expect(report.automationDispatch).toMatchObject({ p95Ms: 5_000 });
    expect(report.searchReady).toMatchObject({ count: 1, p95Ms: 80 });
    expect(report.summary).toMatchObject({
      maxProcessCount: 4,
      rssGrowthBytes: 40,
      privateGrowthBytes: 20,
      jsHeapGrowthBytes: 20,
      coldRssGrowthBytes: 80,
      steadyProcessSampleCount: 5,
    });
    expect(report.verdict.passed).toBe(true);
  });

  it("keeps the packaged gate Windows-only, serial, and uploads evidence", async () => {
    const workflow = await readFile(
      path.join(process.cwd(), ".github", "workflows", "windows-packaged-soak.yml"),
      "utf8",
    );
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("max-parallel: 1");
    expect(workflow).toContain("duration_minutes");
    expect(workflow).toContain('default: "30"');
    expect(workflow).toContain("pnpm perf:packaged:windows");
    expect(workflow).toContain("--mode=smoke");
    expect(workflow).toContain("Test-Path -LiteralPath $driverPath");
    expect(workflow).toContain("ARKLINE_EDGEDRIVER=$driverPath");
    expect(workflow).toContain('--driver="$env:ARKLINE_EDGEDRIVER"');
    expect(workflow).toContain("packaged-smoke-report.json");
    expect(workflow).toContain("arkline-packaged-soak-evidence");
  });
});

function passingSoakMetrics(overrides: Record<string, number | boolean> = {}) {
  return {
    rendererSearchP95Ms: 42,
    rendererJumpP95Ms: 80,
    crashCount: 0,
    unresponsiveCount: 0,
    pendingLoads: 0,
    staleApplyCount: 0,
    searchMissCount: 0,
    rssGrowthBytes: 8 * 1024 * 1024,
    privateGrowthBytes: 8 * 1024 * 1024,
    walGrowthBytes: 2 * 1024 * 1024,
    sharedSdkWalGrowthBytes: 0,
    workerRestartGrowth: 0,
    successfulSearchCount: 4,
    successfulJumpCount: 4,
    eventTimingSupported: true,
    longAnimationFrameSupported: true,
    interactionTimingCount: 20,
    interactionTimingP95Ms: 40,
    jsHeapGrowthBytes: 4 * 1024 * 1024,
    processTreeSampleCount: 9,
    steadyProcessSampleCount: 5,
    indexedFileCount: 1_000,
    indexedContentFileCount: 1_000,
    stalledIndexTaskCount: 0,
    ...overrides,
  };
}
