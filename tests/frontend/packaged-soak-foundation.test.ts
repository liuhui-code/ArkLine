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

  it("uses p95/p99 evidence and blocks crashes, pending work, and growth", () => {
    expect(summarizeSamples([1, 2, 3, 4, 100])).toEqual({
      count: 5,
      p50Ms: 3,
      p95Ms: 100,
      p99Ms: 100,
      maxMs: 100,
    });

    const result = evaluateSoakReport({
      interactionP95Ms: 42,
      interactionP99Ms: 80,
      crashCount: 0,
      unresponsiveCount: 0,
      pendingLoads: 0,
      staleApplyCount: 0,
      rssGrowthBytes: 8 * 1024 * 1024,
      privateGrowthBytes: 8 * 1024 * 1024,
      walGrowthBytes: 2 * 1024 * 1024,
      sharedSdkWalGrowthBytes: 0,
      workerRestartGrowth: 0,
      successfulSearchCount: 4,
      successfulJumpCount: 4,
      eventTimingSupported: true,
      longAnimationFrameSupported: true,
      eventTimingCount: 20,
      eventTimingP95Ms: 40,
      jsHeapGrowthBytes: 4 * 1024 * 1024,
      processTreeSampleCount: 2,
    });
    expect(result.passed).toBe(true);

    expect(evaluateSoakReport({
      interactionP95Ms: 42,
      interactionP99Ms: 80,
      crashCount: 1,
      unresponsiveCount: 0,
      pendingLoads: 0,
      staleApplyCount: 0,
      rssGrowthBytes: 8 * 1024 * 1024,
      privateGrowthBytes: 8 * 1024 * 1024,
      walGrowthBytes: 2 * 1024 * 1024,
      sharedSdkWalGrowthBytes: 0,
      workerRestartGrowth: 0,
      successfulSearchCount: 4,
      successfulJumpCount: 4,
      eventTimingSupported: true,
      longAnimationFrameSupported: true,
      eventTimingCount: 20,
      eventTimingP95Ms: 40,
      jsHeapGrowthBytes: 4 * 1024 * 1024,
      processTreeSampleCount: 2,
    })).toMatchObject({
      passed: false,
      failures: expect.arrayContaining(["app-or-editor-crash"]),
    });

    expect(evaluateSoakReport({
      interactionP95Ms: 1,
      interactionP99Ms: 2,
      crashCount: 0,
      unresponsiveCount: 0,
      pendingLoads: 0,
      staleApplyCount: 0,
      rssGrowthBytes: 0,
      privateGrowthBytes: 0,
      walGrowthBytes: 0,
      sharedSdkWalGrowthBytes: 0,
      workerRestartGrowth: 0,
      successfulSearchCount: 0,
      successfulJumpCount: 0,
      eventTimingSupported: true,
      longAnimationFrameSupported: true,
      eventTimingCount: 20,
      eventTimingP95Ms: 20,
      jsHeapGrowthBytes: 0,
      processTreeSampleCount: 2,
    })).toMatchObject({
      passed: false,
      failures: expect.arrayContaining(["no-search-result", "no-navigation"]),
    });

    expect(evaluateSoakReport({
      interactionP95Ms: 1,
      interactionP99Ms: 2,
      crashCount: 0,
      unresponsiveCount: 0,
      pendingLoads: 0,
      staleApplyCount: 0,
      rssGrowthBytes: 0,
      privateGrowthBytes: 0,
      walGrowthBytes: 0,
      sharedSdkWalGrowthBytes: 0,
      workerRestartGrowth: 0,
      successfulSearchCount: 1,
      successfulJumpCount: 1,
      eventTimingSupported: false,
      longAnimationFrameSupported: false,
      eventTimingCount: 0,
      eventTimingP95Ms: 0,
      jsHeapGrowthBytes: 0,
      processTreeSampleCount: 0,
    })).toMatchObject({
      passed: false,
      failures: expect.arrayContaining([
        "missing-event-timing",
        "missing-long-animation-frame",
        "no-process-tree-evidence",
      ]),
    });
  });

  it("keeps WebView telemetry bounded and separates frame blocking evidence", () => {
    expect(TELEMETRY_INSTALL_SCRIPT).toContain('supported.has("event")');
    expect(TELEMETRY_INSTALL_SCRIPT).toContain(
      'supported.has("long-animation-frame")',
    );
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("items.length < limit");
    expect(telemetryDurations({
      eventTimings: [{ duration: 18 }, { duration: 42 }],
      longAnimationFrames: [
        { duration: 80, blockingDuration: 12 },
        { duration: 120, blockingDuration: 40 },
      ],
    })).toEqual({
      eventTimings: [18, 42],
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
      schemaVersion: 2,
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
      interactionSamples: [10, 20],
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
      processSamples: [
        { processCount: 4, rssBytes: 100, privateBytes: 80, handleCount: 10, threadCount: 5 },
        { processCount: 4, rssBytes: 140, privateBytes: 100, handleCount: 12, threadCount: 6 },
      ],
      heapSamples: [
        { supported: true, usedBytes: 40 },
        { supported: true, usedBytes: 60 },
      ],
      telemetry: {
        capabilities: { eventTiming: true, longAnimationFrame: true },
        errors: [],
        eventTimings: [{ duration: 20 }],
        frameGaps: [],
        longAnimationFrames: [],
        longTasks: [],
        eventTimingCount: 1,
        frames: 60,
      },
    });

    expect(report.schemaVersion).toBe(2);
    expect(report.searchReady).toMatchObject({ count: 1, p95Ms: 80 });
    expect(report.summary).toMatchObject({
      maxProcessCount: 4,
      rssGrowthBytes: 40,
      privateGrowthBytes: 20,
      jsHeapGrowthBytes: 20,
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
    expect(workflow).toContain("packaged-smoke-report.json");
    expect(workflow).toContain("arkline-packaged-soak-evidence");
  });
});
