#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parsePackagedSoakArguments } from "./packaged-soak-model.mjs";
import { buildFixtureRelativePath } from "./generate-performance-fixture.mjs";
import { inspectPackagedSoakPreflight } from "./packaged-soak-preflight.mjs";
import {
  PackagedWebDriver,
  WEBDRIVER_KEYS,
} from "./packaged-soak-webdriver.mjs";
import {
  WindowsPackagedAutomationSession,
} from "./packaged-soak-windows-session.mjs";
import {
  DIAGNOSTICS_SCRIPT,
  HEAP_SNAPSHOT_SCRIPT,
  TELEMETRY_INSTALL_SCRIPT,
  TELEMETRY_SNAPSHOT_SCRIPT,
} from "./packaged-soak-telemetry.mjs";
import {
  waitForDiscoveryReady,
  waitForInteractiveIndexReady,
  waitForWorkspace,
} from "./packaged-soak-readiness.mjs";
import {
  parsePowerShellProcessPayload,
  summarizeProcessEvidence,
  WINDOWS_PROCESS_TREE_SCRIPT,
} from "./packaged-soak-process-evidence.mjs";
import {
  buildPackagedSoakFailureReport,
  buildPackagedSoakReport,
  inspectApplicationArtifact,
  inspectFixture,
} from "./packaged-soak-report.mjs";
import {
  detectCrashSurface,
  exerciseEditorInteraction,
} from "./packaged-soak-editor-workload.mjs";
import {
  completionTargetForCycle,
  definitionTargetForCycle,
  loadPackagedSoakScenario,
} from "./packaged-soak-scenario.mjs";
import {
  exerciseFindInFiles,
  exerciseQuickOpen,
} from "./packaged-soak-search-workload.mjs";
import {
  exerciseDefinitionNavigation,
  exerciseMemberCompletion,
} from "./packaged-soak-semantic-workload.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const options = parsePackagedSoakArguments();
  const startedAt = Date.now();
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  let phase = "platform";
  let preflight = null;
  let automation = null;
  let driver = null;
  let scenario = null;
  let report;
  try {
    if (process.platform !== "win32") {
      throw new Error("The packaged soak must run on native Windows");
    }
    phase = "scenario";
    scenario = await loadPackagedSoakScenario(options);
    scenario.sdkPath = options.sdkPath;
    phase = "preflight";
    preflight = await inspectPackagedSoakPreflight(options);
    assertPreflightPassed(preflight);
    automation = new WindowsPackagedAutomationSession(options);
    phase = "application-start";
    await automation.startApplication();
    phase = "application-grace";
    await automation.waitForApplicationGrace();
    phase = "driver-start";
    await automation.startDriver();
    driver = new PackagedWebDriver(automation.driverBaseUrl());
    phase = "driver-ready";
    await automation.waitForDriver(driver);
    phase = "session-create";
    await driver.createAttachedSession(automation.debuggerAddress());
    phase = "mixed-workload";
    report = await runSoak(driver, options, scenario);
    report.scenario = scenario;
    report.driverCapabilities = driver.capabilities;
    report.preflight = preflight;
  } catch (error) {
    report = buildPackagedSoakFailureReport({
      options,
      startedAt,
      failedAt: Date.now(),
      phase,
      error,
      preflight,
    });
  } finally {
    await driver?.close();
    await automation?.captureProcessEvidence();
    await automation?.stop();
  }
  report.applicationArtifact = await safeEvidence(() =>
    inspectApplicationArtifact(options.applicationPath));
  report.fixture = await safeEvidence(() => inspectFixture(options.fixturePath, scenario));
  report.scenario ??= scenario;
  report.automation = automation?.evidence() ?? null;
  if (report.automation?.driver) {
    report.automation.driver.capabilities = driver?.capabilities ?? {};
  }
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `ARKLINE_PACKAGED_SOAK ${JSON.stringify(report.summary ?? report.verdict)}`,
  );
  if (options.strict && !report.verdict.passed) process.exitCode = 1;
}

async function runSoak(driver, options, scenario) {
  await driver.waitForSelectorPresent('[aria-label="Application Header"]', 60_000);
  await waitForWorkspace(driver, options.fixturePath, 90_000);
  if (options.mode === "smoke" && scenario.kind === "generated") {
    await waitForInteractiveIndexReady(
      driver,
      options.fixturePath,
      path.join(options.fixturePath, buildFixtureRelativePath(0)),
      90_000,
    );
  } else {
    await waitForDiscoveryReady(driver, options.fixturePath, 180_000);
  }
  const telemetryCapabilities = await driver.execute(TELEMETRY_INSTALL_SCRIPT);
  const startedAt = Date.now();
  const deadline = startedAt + options.durationMs;
  const automationDispatchSamples = [];
  const searchReadySamples = [];
  const jumpSamples = [];
  const editorInputSamples = [];
  const editorScrollSamples = [];
  const definitionSamples = [];
  const completionSamples = [];
  const diagnostics = [];
  const processSamples = [];
  const heapSamples = [];
  const searchEvidence = [];
  const semanticEvidence = [];
  const counters = {
    attempts: 0,
    cycles: 0,
    crashCount: 0,
    unresponsiveCount: 0,
    staleApplyCount: 0,
    searchMissCount: 0,
    findInFilesMissCount: 0,
    quickOpenMissCount: 0,
    editorInteractionFailureCount: 0,
    editorScrollSkipCount: 0,
    definitionMissCount: 0,
    completionMissCount: 0,
  };
  let nextEvidenceAt = 0;
  while (
    Date.now() < deadline
    && counters.attempts < options.maxCycles
  ) {
    counters.attempts += 1;
    if (Date.now() >= nextEvidenceAt) {
      diagnostics.push(await inspectDiagnostics(driver, options.fixturePath));
      processSamples.push(
        await inspectArkLineProcesses(options.applicationPath),
      );
      heapSamples.push(await inspectHeap(driver));
      nextEvidenceAt = Date.now() + 30_000;
    }
    try {
      await exerciseFindInFiles(
        driver,
        counters.cycles,
        automationDispatchSamples,
        searchReadySamples,
        counters,
        searchEvidence,
        scenario,
      );
      const fileOpened = await exerciseQuickOpen(
        driver,
        counters.cycles,
        jumpSamples,
        counters,
        searchEvidence,
        scenario,
      );
      if (fileOpened) {
        try {
          const editor = await exerciseEditorInteraction(driver);
          editorInputSamples.push(
            editor.inputVisibleMs,
            editor.deleteVisibleMs,
          );
          if (editor.scrollMoved) editorScrollSamples.push(editor.scrollFrameMs);
          else counters.editorScrollSkipCount += 1;
        } catch (error) {
          counters.editorInteractionFailureCount += 1;
          counters.lastEditorError = String(error);
          throw error;
        }
      }
      const definitionTarget = definitionTargetForCycle(scenario, counters.cycles);
      if (definitionTarget) {
        await exerciseDefinitionNavigation(
          driver,
          definitionTarget,
          definitionSamples,
          counters,
          semanticEvidence,
        );
      }
      const completionTarget = completionTargetForCycle(scenario, counters.cycles);
      if (completionTarget) {
        await exerciseMemberCompletion(
          driver,
          completionTarget,
          completionSamples,
          counters,
          semanticEvidence,
        );
      }
      await detectCrashSurface(driver, counters);
      counters.cycles += 1;
    } catch (error) {
      counters.unresponsiveCount += 1;
      counters.lastInteractionError = String(error);
      await driver.keyChord([WEBDRIVER_KEYS.escape]).catch(() => undefined);
      if (counters.unresponsiveCount >= 3) break;
    }
  }
  diagnostics.push(await inspectDiagnostics(driver, options.fixturePath));
  processSamples.push(await inspectArkLineProcesses(options.applicationPath));
  heapSamples.push(await inspectHeap(driver));
  const telemetry = await driver.execute(TELEMETRY_SNAPSHOT_SCRIPT).catch(
    (error) => ({
      capabilities: telemetryCapabilities,
      errors: [String(error)],
      eventTimings: [],
      frameGaps: [],
      longAnimationFrames: [],
      longTasks: [],
      frames: 0,
    }),
  );
  counters.crashCount += telemetry.errorCount ?? telemetry.errors.length;
  return buildPackagedSoakReport({
    options,
    startedAt,
    counters,
    automationDispatchSamples,
    searchReadySamples,
    jumpSamples,
    editorInputSamples,
    editorScrollSamples,
    definitionSamples,
    completionSamples,
    diagnostics,
    processSamples,
    heapSamples,
    searchEvidence,
    semanticEvidence,
    scenario,
    telemetry,
  });
}

async function inspectDiagnostics(driver, rootPath) {
  const response = await driver.executeAsync(DIAGNOSTICS_SCRIPT, [rootPath]);
  if (!response?.ok) return { capturedAt: Date.now(), error: response?.error };
  const value = response.value;
  return {
    capturedAt: Date.now(),
    status: value.status,
    fileCount: value.fileCount,
    symbolCount: value.symbolCount,
    contentLineCount: value.contentLineCount,
    contentFileCount: indexedLayerCount(value, "content"),
    stubFileCount: indexedLayerCount(value, "stub"),
    parserErrorCount: value.parserErrorCount,
    discoveredFileCount: value.discoveredFileCount,
    discoveryExcludedCount: value.discoveryExcludedCount,
    discoveryStatus: value.discoveryStatus,
    discoveryHasMore: value.discoveryHasMore,
    freshnessLayers: value.freshnessLayers,
    walSizeBytes: value.walSizeBytes ?? 0,
    freelistBytes: value.freelistBytes ?? 0,
    queuePending: value.queuePressure?.pendingTaskCount ?? 0,
    writerWaitP95Us: value.writerMetrics?.waitP95Us ?? 0,
    writerHoldP95Us: value.writerMetrics?.holdP95Us ?? 0,
    sharedSdkDbSizeBytes: value.sharedSdkDbSizeBytes ?? 0,
    sharedSdkWalSizeBytes: value.sharedSdkWalSizeBytes ?? 0,
    sharedSdkFreelistBytes: value.sharedSdkFreelistBytes ?? 0,
    sharedSdkArtifactCount: value.sharedSdkArtifactCount ?? 0,
    indexerStatus: value.indexerHost?.status ?? null,
    completedDiscoveryChunks: value.indexerHost?.completedDiscoveryChunks ?? 0,
    completedContentRefreshChunks: value.indexerHost?.completedContentRefreshChunks ?? 0,
    cancelledContentRefreshChunks: value.indexerHost?.cancelledContentRefreshChunks ?? 0,
    completedStubRefreshChunks: value.indexerHost?.completedStubRefreshChunks ?? 0,
    cancelledStubRefreshChunks: value.indexerHost?.cancelledStubRefreshChunks ?? 0,
    indexerFallbackCount: value.indexerHost?.fallbackCount ?? 0,
    workerRestartCount: value.indexerHost?.restartCount ?? 0,
    indexerLastError: value.indexerHost?.lastError ?? null,
    publicationWriterMetrics: value.indexerHost?.publicationWriterMetrics ?? null,
    taskStatuses: (value.taskStatuses ?? []).slice(-16).map((status) => ({
      kind: status.kind,
      status: status.status,
      reason: status.reason,
      generation: status.generation,
      durationMs: status.durationMs,
      lastHeartbeatAt: status.lastHeartbeatAt,
      stalled: status.stalled,
      message: status.message,
      error: status.error,
    })),
  };
}

function indexedLayerCount(value, layerName) {
  return value.layerReadiness?.layers?.find(
    (layer) => layer.layer === layerName,
  )?.indexedCount ?? 0;
}

async function inspectArkLineProcesses(applicationPath) {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", WINDOWS_PROCESS_TREE_SCRIPT],
      {
        env: {
          ...process.env,
          ARKLINE_SOAK_APPLICATION_PATH: applicationPath,
        },
        windowsHide: true,
        timeout: 10_000,
      },
    );
    const processes = parsePowerShellProcessPayload(stdout);
    return {
      capturedAt: Date.now(),
      ...summarizeProcessEvidence(processes),
      processes,
    };
  } catch (error) {
    return { capturedAt: Date.now(), rssBytes: 0, error: String(error), processes: [] };
  }
}

async function inspectHeap(driver) {
  return driver.execute(HEAP_SNAPSHOT_SCRIPT).catch((error) => ({
    supported: false,
    capturedAt: Date.now(),
    error: String(error),
  }));
}

function assertPreflightPassed(preflight) {
  const failures = preflight.checks.filter((check) => !check.passed);
  if (failures.length === 0) return;
  const detail = failures
    .map((check) => `${check.name}: ${check.detail}`)
    .join("; ");
  throw new Error(`Packaged soak preflight failed: ${detail}`);
}

async function safeEvidence(operation) {
  try {
    return await operation();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
