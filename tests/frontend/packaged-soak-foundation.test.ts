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
  PACKAGED_SOAK_LIMITS,
  parsePackagedSoakArguments,
  summarizeSamples,
} from "../../scripts/packaged-soak-model.mjs";
import {
  inspectPackagedSoakPreflight,
  resolveWindowsPowerShell,
} from "../../scripts/packaged-soak-preflight.mjs";
import {
  EVENT_TIMING_SAMPLE_LIMIT,
  TELEMETRY_INSTALL_SCRIPT,
  TELEMETRY_RESET_SAMPLES_SCRIPT,
  RETAINED_HEAP_SNAPSHOT_SCRIPT,
  UI_READINESS_SCRIPT,
  telemetryDurations,
} from "../../scripts/packaged-soak-telemetry.mjs";
import {
  buildPackagedSoakFailureReport,
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
      coreIndexTimeoutMs: 5 * 60_000,
      maxCycles: 1,
    });
    expect(() => parsePackagedSoakArguments([
      "--application=arkline.exe",
      "--fixture=fixture",
      "--core-index-timeout-minutes=0",
    ])).toThrow("core-index-timeout-minutes");
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

    expect(evaluateSoakReport(passingSoakMetrics({
      rendererSearchP99Ms: 751,
      rendererEditorInputP99Ms: 101,
      longTaskMaxMs: 501,
      causalTraceRunningCount: 1,
      causalTraceKindCount: 2,
    }))).toMatchObject({
      failures: expect.arrayContaining([
        "renderer-search-p99",
        "renderer-editor-input-p99",
        "renderer-long-task-max",
        "causal-trace-left-running",
        "incomplete-causal-trace-coverage",
      ]),
    });
  });

  it("keeps WebView telemetry bounded and separates frame blocking evidence", () => {
    expect(EVENT_TIMING_SAMPLE_LIMIT).toBe(512);
    expect(TELEMETRY_INSTALL_SCRIPT).toContain('supported.has("event")');
    expect(TELEMETRY_INSTALL_SCRIPT).toContain(
      'supported.has("long-animation-frame")',
    );
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("items.length < limit");
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("trackedInteractionLabels.has");
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("observer.disconnect()");
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("Workspace query superseded");
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("event.preventDefault()");
    expect(TELEMETRY_INSTALL_SCRIPT).toContain('addEventListener("beforeinput"');
    expect(TELEMETRY_INSTALL_SCRIPT).toContain('event.key === "Enter"');
    expect(TELEMETRY_INSTALL_SCRIPT).not.toContain("MutationObserver");
    expect(TELEMETRY_INSTALL_SCRIPT).not.toContain("requestAnimationFrame(frame)");
    expect(TELEMETRY_INSTALL_SCRIPT).toContain("entry.scripts || []");
    expect(TELEMETRY_RESET_SAMPLES_SCRIPT).toContain("state.interactionStarts = {}");
    expect(TELEMETRY_RESET_SAMPLES_SCRIPT).toContain("state.eventTimings = []");
    expect(RETAINED_HEAP_SNAPSHOT_SCRIPT).toContain("globalThis.gc");
    expect(RETAINED_HEAP_SNAPSHOT_SCRIPT).toContain("openTabCount");
    expect(RETAINED_HEAP_SNAPSHOT_SCRIPT).toContain("openDocumentCount");
    expect(RETAINED_HEAP_SNAPSHOT_SCRIPT).toContain("hotEditorSessionCount");
    expect(RETAINED_HEAP_SNAPSHOT_SCRIPT).toContain("editorStateCreationCount");
    expect(RETAINED_HEAP_SNAPSHOT_SCRIPT).toContain("domNodeCount");
    expect(UI_READINESS_SCRIPT).toContain(
      '[aria-label="Find in Files Results"]',
    );
    expect(UI_READINESS_SCRIPT).toContain(".editor-tab--active");
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
      successfulEditorInputCount: 1,
      successfulEditorScrollCount: 1,
      editorInteractionFailureCount: 0,
      eventTimingSupported: true,
      longAnimationFrameSupported: true,
      processTreeSampleCount: 1,
      causalTraceCount: 3,
      causalTraceErrorCount: 0,
      causalTraceRunningCount: 0,
      causalTraceKindCount: 3,
    })).toMatchObject({ passed: true, failures: [] });

    expect(evaluateSmokeReport({
      crashCount: 0,
      unresponsiveCount: 0,
      staleApplyCount: 0,
      successfulSearchCount: 0,
      successfulJumpCount: 0,
      successfulEditorInputCount: 0,
      successfulEditorScrollCount: 0,
      editorInteractionFailureCount: 1,
      eventTimingSupported: false,
      longAnimationFrameSupported: false,
      processTreeSampleCount: 0,
    })).toMatchObject({
      passed: false,
      failures: expect.arrayContaining([
        "no-search-result",
        "no-navigation",
        "no-editor-input-evidence",
        "no-editor-scroll-evidence",
        "editor-interaction-failure",
        "missing-event-timing",
        "missing-long-animation-frame",
        "no-process-tree-evidence",
      ]),
    });
  });

  it("does not treat one smoke cycle as semantic latency percentile evidence", () => {
    expect(evaluateSmokeReport({
      crashCount: 0,
      unresponsiveCount: 0,
      staleApplyCount: 0,
      successfulSearchCount: 1,
      successfulJumpCount: 1,
      successfulEditorInputCount: 1,
      successfulEditorScrollCount: 1,
      editorInteractionFailureCount: 0,
      eventTimingSupported: true,
      longAnimationFrameSupported: true,
      processTreeSampleCount: 1,
      causalTraceCount: 3,
      causalTraceErrorCount: 0,
      causalTraceRunningCount: 0,
      causalTraceKindCount: 3,
      semanticRequired: true,
      definitionMissCount: 0,
      completionMissCount: 0,
      successfulDefinitionCount: 1,
      successfulCompletionCount: 1,
      rendererDefinitionP95Ms: PACKAGED_SOAK_LIMITS.rendererDefinitionP95Ms + 1,
      rendererCompletionP95Ms: PACKAGED_SOAK_LIMITS.rendererCompletionP95Ms + 1,
    })).toMatchObject({ passed: true, failures: [] });
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
      { phase: "quick-open-miss", resultCount: 0 },
      40,
    )).toBe(true);
    expect(shouldRecordSearchEvidence(
      { phase: "quick-open-enter-failed", resultCount: 0 },
      0,
    )).toBe(true);
  });

  it("keeps the packaged mixed workload free of retained element references", async () => {
    const source = await readFile(
      path.resolve("scripts/run-windows-packaged-soak.mjs"),
      "utf8",
    );

    expect(source).not.toContain(".waitForSelector(");
    expect(source).not.toContain(".findElement(");
    expect(source).not.toContain(".sendToActive(");
    expect(source).not.toContain(".sendKeys(");
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
        JSON.stringify({ version: 2, profile: "small", fileCount: 1_000 }),
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

  it("falls back to PowerShell 7 when Windows PowerShell is unavailable", async () => {
    const attempts: string[] = [];
    const resolved = await resolveWindowsPowerShell(async (command: string) => {
      attempts.push(command);
      if (command === "powershell.exe") throw new Error("missing");
      return "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    }, {});

    expect(attempts).toEqual(["powershell.exe", "pwsh.exe"]);
    expect(resolved).toContain("pwsh.exe");
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
      schemaVersion: 7,
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
    expect(workflow).toContain("--strict");
    expect(workflow).toContain("Test-Path -LiteralPath $driverPath");
    expect(workflow).toContain("ARKLINE_EDGEDRIVER=$driverPath");
    expect(workflow).toContain('--driver="$env:ARKLINE_EDGEDRIVER"');
    expect(workflow).toContain("packaged-smoke-report.json");
    expect(workflow).toContain("arkline-packaged-soak-evidence");
    expect(workflow).toContain('ARKLINE_INDEXER_ENABLED: "0"');
    expect(workflow.match(/ARKLINE_INDEXER_ENABLED/g)).toHaveLength(1);
    expect(workflow).toContain("Joker-x-dev/CoolMallArkTS");
    expect(workflow).toContain("17b6899086a57a4d48448842a14f9e325e3e35a3");
    expect(workflow).toContain("core-loop-coolmall-v1.json");
    expect(workflow).toContain("packaged-real-project-report.json");
    expect(workflow).toContain("--sdk=semantic-worker/fixtures/golden-corpus/v1/sdk/openharmony");
  });
});

function passingSoakMetrics(overrides: Record<string, number | boolean> = {}) {
  return {
    rendererSearchP95Ms: 42,
    rendererJumpP95Ms: 80,
    rendererEditorInputP95Ms: 20,
    rendererEditorScrollP95Ms: 16,
    rendererDefinitionP95Ms: 0,
    rendererCompletionP95Ms: 0,
    rendererSearchP99Ms: 80,
    rendererJumpP99Ms: 120,
    rendererEditorInputP99Ms: 40,
    rendererEditorScrollP99Ms: 32,
    crashCount: 0,
    unresponsiveCount: 0,
    editorInteractionFailureCount: 0,
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
    successfulEditorInputCount: 4,
    successfulEditorScrollCount: 4,
    semanticRequired: false,
    definitionMissCount: 0,
    completionMissCount: 0,
    successfulDefinitionCount: 0,
    successfulCompletionCount: 0,
    eventTimingSupported: true,
    longAnimationFrameSupported: true,
    interactionTimingCount: 20,
    interactionTimingP95Ms: 40,
    longTaskMaxMs: 80,
    causalTraceCount: 30,
    causalTraceErrorCount: 0,
    causalTraceRunningCount: 0,
    causalTraceKindCount: 3,
    jsHeapGrowthBytes: 4 * 1024 * 1024,
    processTreeSampleCount: 9,
    steadyProcessSampleCount: 5,
    indexedFileCount: 1_000,
    indexedContentFileCount: 1_000,
    eligibleContentFileCount: 1_000,
    stalledIndexTaskCount: 0,
    ...overrides,
  };
}
