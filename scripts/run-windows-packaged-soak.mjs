#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parsePackagedSoakArguments } from "./packaged-soak-model.mjs";
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
  rendererInteractionStart,
  waitForActiveTab,
  waitForDiscoveryReady,
  waitForFullIndexReady,
  waitForSearchResult,
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
  SEARCH_UI_EVIDENCE_SCRIPT,
  shouldRecordSearchEvidence,
} from "./packaged-soak-search-evidence.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  const options = parsePackagedSoakArguments();
  const startedAt = Date.now();
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  let phase = "platform";
  let preflight = null;
  let automation = null;
  let driver = null;
  let report;
  try {
    if (process.platform !== "win32") {
      throw new Error("The packaged soak must run on native Windows");
    }
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
    report = await runSoak(driver, options);
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
  report.fixture = await safeEvidence(() => inspectFixture(options.fixturePath));
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

async function runSoak(driver, options) {
  await driver.waitForSelector('[aria-label="Application Header"]', 60_000);
  await waitForWorkspace(driver, options.fixturePath, 90_000);
  if (options.mode === "smoke") {
    await waitForFullIndexReady(driver, options.fixturePath, 90_000);
  } else {
    await waitForDiscoveryReady(driver, options.fixturePath, 180_000);
  }
  const telemetryCapabilities = await driver.execute(TELEMETRY_INSTALL_SCRIPT);
  const startedAt = Date.now();
  const deadline = startedAt + options.durationMs;
  const automationDispatchSamples = [];
  const searchReadySamples = [];
  const jumpSamples = [];
  const diagnostics = [];
  const processSamples = [];
  const heapSamples = [];
  const searchEvidence = [];
  const counters = {
    attempts: 0,
    cycles: 0,
    crashCount: 0,
    unresponsiveCount: 0,
    staleApplyCount: 0,
    searchMissCount: 0,
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
        searchEvidence,
      );
      await exerciseQuickOpen(
        driver,
        counters.cycles,
        jumpSamples,
        counters,
        searchEvidence,
      );
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
    diagnostics,
    processSamples,
    heapSamples,
    searchEvidence,
    telemetry,
  });
}

async function exerciseFindInFiles(
  driver,
  cycle,
  automationDispatchSamples,
  readySamples,
  searchEvidence,
) {
  await driver.keyChord([
    WEBDRIVER_KEYS.control,
    WEBDRIVER_KEYS.shift,
    "f",
  ]);
  const input = await driver.waitForSelector('[aria-label="Find in Files Query"]');
  const query = `arklineSearchNeedle${cycle % 1000}`;
  automationDispatchSamples.push(await timed(() => driver.sendKeys(input, query)));
  const searchStarted = await rendererInteractionStart(
    driver,
    "input:Find in Files Query",
  );
  await captureSearchEvidence(
    driver,
    "find-typed",
    "Find in Files Query",
    "Find in Files Results",
    searchEvidence,
  );
  const ready = await waitForSearchResult(
    driver,
    "Find in Files Results",
    query,
    5_000,
  ).catch(() => null);
  if (ready) {
    readySamples.push(Math.max(0, ready.at - searchStarted));
    await captureSearchEvidence(
      driver,
      "find-ready",
      "Find in Files Query",
      "Find in Files Results",
      searchEvidence,
    );
    await driver.sendToActive(WEBDRIVER_KEYS.arrowDown);
  } else {
    await captureSearchEvidence(
      driver,
      "find-miss",
      "Find in Files Query",
      "Find in Files Results",
      searchEvidence,
    );
  }
  automationDispatchSamples.push(await timed(
    () => driver.sendToActive(WEBDRIVER_KEYS.backspace.repeat(6)),
  ));
  await driver.keyChord([WEBDRIVER_KEYS.escape]);
}

async function exerciseQuickOpen(driver, cycle, jumpSamples, counters, searchEvidence) {
  const pageIndex = (cycle * 97) % 1000;
  const pageName = `Page${String(pageIndex).padStart(6, "0")}`;
  await driver.keyChord([WEBDRIVER_KEYS.control, "p"]);
  const input = await driver.waitForSelector('[aria-label="Quick Open Query"]');
  await driver.sendKeys(input, pageName);
  await captureSearchEvidence(
    driver,
    "quick-open-typed",
    "Quick Open Query",
    "Quick Open Results",
    searchEvidence,
  );
  const resultSelector = '[aria-label="Quick Open Results"] button';
  if (!(await waitForOptionalSelector(driver, resultSelector, 8_000))) {
    counters.searchMissCount += 1;
    await captureSearchEvidence(
      driver,
      "quick-open-miss",
      "Quick Open Query",
      "Quick Open Results",
      searchEvidence,
    );
    await driver.keyChord([WEBDRIVER_KEYS.escape]);
    return;
  }
  await captureSearchEvidence(
    driver,
    "quick-open-ready",
    "Quick Open Query",
    "Quick Open Results",
    searchEvidence,
  );
  await driver.keyChord([WEBDRIVER_KEYS.enter]);
  const started = await rendererInteractionStart(
    driver,
    "enter:Quick Open Query",
  );
  let activeTab;
  try {
    activeTab = await waitForActiveTab(driver, pageName, 10_000);
  } catch (error) {
    await captureSearchEvidence(
      driver,
      "quick-open-enter-failed",
      "Quick Open Query",
      "Quick Open Results",
      searchEvidence,
    );
    throw error;
  }
  jumpSamples.push(Math.max(0, activeTab.at - started));
  if (!activeTab.title.includes(pageName)) counters.staleApplyCount += 1;
}

async function detectCrashSurface(driver, counters) {
  const text = await driver.pageText();
  if (
    text.includes("ArkLine hit a UI error")
    || text.includes("Editor crash")
    || text.includes("Restart the app window")
  ) {
    counters.crashCount += 1;
    throw new Error("Crash boundary became visible");
  }
}

async function waitForOptionalSelector(driver, selector, timeoutMs) {
  return driver.waitForSelector(selector, timeoutMs).then(() => true, () => false);
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
    indexerFallbackCount: value.indexerHost?.fallbackCount ?? 0,
    workerRestartCount: value.indexerHost?.restartCount ?? 0,
    indexerLastError: value.indexerHost?.lastError ?? null,
    publicationWriterMetrics: value.indexerHost?.publicationWriterMetrics ?? null,
    taskStatuses: (value.taskStatuses ?? []).slice(0, 16).map((status) => ({
      kind: status.kind,
      status: status.status,
      reason: status.reason,
      generation: status.generation,
      durationMs: status.durationMs,
      lastHeartbeatAt: status.lastHeartbeatAt,
      message: status.message,
      error: status.error,
    })),
  };
}

async function captureSearchEvidence(
  driver,
  phase,
  queryLabel,
  resultsLabel,
  evidenceItems,
) {
  const evidence = await driver.execute(
    SEARCH_UI_EVIDENCE_SCRIPT,
    [phase, queryLabel, resultsLabel],
  ).catch((error) => ({
    capturedAt: Date.now(),
    phase,
    error: String(error),
    resultCount: 0,
  }));
  if (shouldRecordSearchEvidence(evidence, evidenceItems.length)) {
    evidenceItems.push(evidence);
  }
  return evidence;
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

async function timed(operation) {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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
