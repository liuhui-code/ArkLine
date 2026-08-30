import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  evaluateSmokeReport,
  evaluateSoakReport,
  summarizeSamples,
} from "./packaged-soak-model.mjs";
import { telemetryDurations } from "./packaged-soak-telemetry.mjs";
import { summarizeProcessAttribution } from "./packaged-soak-process-attribution.mjs";

const MEMORY_WARMUP_SAMPLE_COUNT = 4;

export function buildPackagedSoakReport(input) {
  const automationDispatch = summarizeSamples(
    input.automationDispatchSamples ?? input.interactionSamples ?? [],
  );
  const searchReady = summarizeSamples(input.searchReadySamples);
  const jumps = summarizeSamples(input.jumpSamples);
  const editorAutomation = summarizeSamples(input.editorInputSamples ?? []);
  const editorScroll = summarizeSamples(input.editorScrollSamples ?? []);
  const definitions = summarizeSamples(input.definitionSamples ?? []);
  const completions = summarizeSamples(input.completionSamples ?? []);
  const validProcessSamples = input.processSamples.filter(
    (sample) => sample.processCount > 0,
  );
  const rssSamples = numericSamples(validProcessSamples, "rssBytes");
  const privateSamples = numericSamples(validProcessSamples, "privateBytes");
  const usedHeapSamples = input.heapSamples
    .filter((sample) => sample.supported)
    .map((sample) => sample.usedBytes);
  const telemetry = telemetryDurations(input.telemetry);
  const editorInput = summarizeSamples(successfulTraceDurations(
    input.telemetry.interactionTraces ?? [],
    "editorInput",
  ));
  const firstDiagnostics = input.diagnostics.find((item) => !item.error) ?? {};
  const lastDiagnostics = [...input.diagnostics]
    .reverse()
    .find((item) => !item.error) ?? {};
  const eventTimings = summarizeSamples(telemetry.eventTimings);
  const interactionTimings = summarizeSamples(telemetry.interactionTimings);
  const causalTraces = causalTraceMetrics(input.telemetry.interactionTraces ?? []);
  const steadyRssSamples = steadySamples(rssSamples);
  const steadyPrivateSamples = steadySamples(privateSamples);
  const steadyHeapSamples = steadySamples(usedHeapSamples);
  const indexCoverage = summarizeIndexCoverage(input.diagnostics);
  const rendererResources = summarizeRendererResources(input.rendererSamples ?? []);
  const semanticRuntime = summarizeSemanticRuntime(input.diagnostics);
  const processAttribution = summarizeProcessAttribution(input.processSamples);
  const verdictMetrics = {
    rendererSearchP95Ms: searchReady.p95Ms,
    rendererJumpP95Ms: jumps.p95Ms,
    rendererEditorInputP95Ms: editorInput.p95Ms,
    rendererEditorScrollP95Ms: editorScroll.p95Ms,
    rendererDefinitionP95Ms: definitions.p95Ms,
    rendererCompletionP95Ms: completions.p95Ms,
    rendererSearchP99Ms: searchReady.p99Ms,
    rendererJumpP99Ms: jumps.p99Ms,
    rendererEditorInputP99Ms: editorInput.p99Ms,
    rendererEditorScrollP99Ms: editorScroll.p99Ms,
    crashCount: input.counters.crashCount,
    unresponsiveCount: input.counters.unresponsiveCount,
    pendingLoads: countPendingDocumentLoads(
      input.telemetry.interactionTraces ?? [],
    ),
    staleApplyCount: input.counters.staleApplyCount,
    searchMissCount: input.counters.searchMissCount,
    editorInteractionFailureCount:
      input.counters.editorInteractionFailureCount ?? 0,
    rssGrowthBytes: growth(steadyRssSamples),
    privateGrowthBytes: growth(steadyPrivateSamples),
    walGrowthBytes: fieldGrowth(
      firstDiagnostics,
      lastDiagnostics,
      "walSizeBytes",
    ),
    sharedSdkWalGrowthBytes: fieldGrowth(
      firstDiagnostics,
      lastDiagnostics,
      "sharedSdkWalSizeBytes",
    ),
    workerRestartGrowth: fieldGrowth(
      firstDiagnostics,
      lastDiagnostics,
      "workerRestartCount",
    ),
    successfulSearchCount: searchReady.count,
    successfulJumpCount: jumps.count,
    successfulEditorInputCount: editorInput.count,
    successfulEditorScrollCount: editorScroll.count,
    semanticRequired: input.scenario?.kind === "real-workspace",
    semanticWorkerHealthy:
      lastDiagnostics.semanticSupervisor?.status === "running",
    definitionMissCount: input.counters.definitionMissCount ?? 0,
    completionMissCount: input.counters.completionMissCount ?? 0,
    successfulDefinitionCount: definitions.count,
    successfulCompletionCount: completions.count,
    eventTimingSupported: Boolean(input.telemetry.capabilities?.eventTiming),
    longAnimationFrameSupported: Boolean(
      input.telemetry.capabilities?.longAnimationFrame,
    ),
    interactionTimingCount: interactionTimings.count,
    interactionTimingP95Ms: interactionTimings.p95Ms,
    longTaskMaxMs: maximum(input.telemetry.longTasks ?? []),
    ...causalTraces,
    jsHeapGrowthBytes: growth(steadyHeapSamples),
    rendererJsHeapGrowthBytes: rendererResources.usedHeapGrowthBytes,
    rendererDomNodeGrowth: rendererResources.domNodeGrowth,
    rendererRenderGrowth: rendererResources.renderGrowth,
    semanticWorkerRssGrowthBytes: semanticRuntime.rssGrowthBytes,
    semanticWorkerHeapGrowthBytes: semanticRuntime.heapGrowthBytes,
    rendererProcessPrivateGrowthBytes: processAttribution.renderer?.privateGrowthBytes ?? 0,
    semanticWorkerProcessPrivateGrowthBytes: processAttribution.semanticWorker?.privateGrowthBytes ?? 0,
    processTreeSampleCount: validProcessSamples.length,
    steadyProcessSampleCount: Math.min(
      steadyRssSamples.length,
      steadyPrivateSamples.length,
    ),
    indexedFileCount: lastDiagnostics.fileCount ?? 0,
    indexedContentFileCount: lastDiagnostics.contentFileCount ?? 0,
    eligibleContentFileCount: lastDiagnostics.contentEligibleFileCount ?? 0,
    coreIndexCoverageVerified: indexCoverage.coreReady,
    backgroundIndexProgressObserved: indexCoverage.backgroundProgressObserved,
    stalledIndexTaskCount: (lastDiagnostics.taskStatuses ?? []).filter(
      (status) => status.status === "running" && status.stalled,
    ).length,
  };
  const verdict = input.options.mode === "smoke"
    ? evaluateSmokeReport(verdictMetrics)
    : evaluateSoakReport(verdictMetrics);
  return {
    schemaVersion: 7,
    mode: input.options.mode ?? "soak",
    platform: platformEvidence(),
    ci: ciEvidence(),
    applicationPath: input.options.applicationPath,
    fixturePath: input.options.fixturePath,
    startedAt: input.startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - input.startedAt,
    counters: input.counters,
    automationDispatch,
    searchReady,
    jumps,
    editorInput,
    editorAutomation,
    editorScroll,
    definitions,
    completions,
    telemetry: telemetryEvidence(
      input.telemetry,
      telemetry,
      eventTimings,
      interactionTimings,
    ),
    diagnostics: input.diagnostics,
    indexCoverage,
    processSamples: input.processSamples,
    processAttribution,
    heapSamples: input.heapSamples,
    rendererSamples: input.rendererSamples ?? [],
    rendererResources,
    semanticRuntime,
    retentionEvidence: input.retentionEvidence ?? null,
    searchEvidence: input.searchEvidence ?? [],
    semanticEvidence: input.semanticEvidence ?? [],
    summary: {
      ...verdictMetrics,
      coldRssGrowthBytes: growth(rssSamples),
      coldPrivateGrowthBytes: growth(privateSamples),
      coldJsHeapGrowthBytes: growth(usedHeapSamples),
      memoryWarmupSampleCount: MEMORY_WARMUP_SAMPLE_COUNT,
      maxRssBytes: maximum(rssSamples),
      maxPrivateBytes: maximum(privateSamples),
      maxProcessCount: maximum(numericSamples(input.processSamples, "processCount")),
      maxHandleCount: maximum(numericSamples(input.processSamples, "handleCount")),
      maxThreadCount: maximum(numericSamples(input.processSamples, "threadCount")),
      editorAutomationP95Ms: editorAutomation.p95Ms,
    },
    verdict,
  };
}

function summarizeRendererResources(samples) {
  const valid = samples.filter((sample) => !sample.error);
  const usedBytes = numericSamples(valid, "usedBytes");
  const domNodes = numericSamples(valid, "domNodeCount");
  const appShellRenders = valid
    .map((sample) => renderPressureCount(sample.renderPressure, "AppShell"))
    .filter(Number.isFinite);
  return {
    sampleCount: valid.length,
    first: valid.at(0) ?? null,
    last: valid.at(-1) ?? null,
    usedHeapGrowthBytes: growth(steadySamples(usedBytes)),
    domNodeGrowth: growth(domNodes),
    renderGrowth: growth(appShellRenders),
  };
}

function renderPressureCount(value, label) {
  if (Array.isArray(value)) {
    return value.find((item) => item.label === label)?.count;
  }
  return value?.counts?.[label];
}

function summarizeSemanticRuntime(diagnostics) {
  const samples = diagnostics
    .filter((item) => !item.error && item.semanticRuntime)
    .map((item) => ({ capturedAt: item.capturedAt, ...item.semanticRuntime }));
  return {
    sampleCount: samples.length,
    first: samples.at(0) ?? null,
    last: samples.at(-1) ?? null,
    rssGrowthBytes: growth(steadySamples(numericSamples(samples, "rssBytes"))),
    heapGrowthBytes: growth(steadySamples(numericSamples(samples, "heapUsedBytes"))),
  };
}

export function summarizeIndexCoverage(diagnostics) {
  const snapshots = diagnostics
    .filter((item) => !item.error)
    .map((item) => ({
      capturedAt: item.capturedAt,
      fileCount: item.fileCount ?? 0,
      discoveredFileCount: item.discoveredFileCount ?? 0,
      discoveryStatus: item.discoveryStatus ?? null,
      contentFileCount: item.contentFileCount ?? 0,
      contentEligibleFileCount: item.contentEligibleFileCount ?? 0,
      contentPolicySkippedFileCount: item.contentPolicySkippedFileCount ?? 0,
      stubFileCount: item.stubFileCount ?? 0,
      layers: (item.freshnessLayers ?? []).map((layer) => ({
        layer: layer.layer,
        readyCount: layer.readyCount ?? 0,
        staleCount: layer.staleCount ?? 0,
        missingCount: layer.missingCount ?? 0,
        eligibleCount: layer.eligibleCount ?? item.fileCount ?? 0,
        skippedCount: layer.skippedCount ?? 0,
      })),
    }));
  const first = snapshots.at(0) ?? null;
  const last = snapshots.at(-1) ?? null;
  const content = layer(last, "content");
  return {
    sampleCount: snapshots.length,
    first,
    last,
    contentAdvanced: (last?.contentFileCount ?? 0) > (first?.contentFileCount ?? 0),
    stubAdvanced: (last?.stubFileCount ?? 0) > (first?.stubFileCount ?? 0),
    backgroundProgressObserved:
      (last?.contentFileCount ?? 0) > (first?.contentFileCount ?? 0)
      || (last?.stubFileCount ?? 0) > (first?.stubFileCount ?? 0),
    coreReady: Boolean(
      last
      && last.discoveryStatus === "ready"
      && last.discoveredFileCount > 0
      && last.fileCount >= last.discoveredFileCount
      && content?.missingCount === 0
      && content.staleCount === 0
      && content.readyCount >= last.fileCount
      && content.eligibleCount + content.skippedCount >= last.fileCount
    ),
    contentLayer: content ?? null,
  };
}

function layer(snapshot, name) {
  return snapshot?.layers.find((item) => item.layer === name) ?? null;
}

export function buildPackagedSoakFailureReport(input) {
  return {
    schemaVersion: 7,
    mode: input.options.mode ?? "soak",
    platform: platformEvidence(),
    ci: ciEvidence(),
    applicationPath: input.options.applicationPath,
    fixturePath: input.options.fixturePath,
    startedAt: input.startedAt,
    finishedAt: input.failedAt,
    durationMs: input.failedAt - input.startedAt,
    preflight: input.preflight ?? null,
    fatalError: {
      phase: input.phase,
      message: errorMessage(input.error),
      stack: input.error instanceof Error ? input.error.stack ?? null : null,
    },
    verdict: {
      passed: false,
      failures: ["harness-failure"],
    },
  };
}

export async function inspectApplicationArtifact(applicationPath) {
  const metadata = await stat(applicationPath);
  const sha256 = await hashFile(applicationPath);
  return { path: applicationPath, sizeBytes: metadata.size, sha256 };
}

export async function inspectFixture(fixturePath, scenario = null) {
  if (scenario?.kind === "real-workspace") {
    return {
      kind: scenario.kind,
      rootPath: fixturePath,
      revision: scenario.revision,
      sdkIdentity: scenario.sdkIdentity,
      ...(scenario.sdkPath ? { sdkPath: scenario.sdkPath } : {}),
      ...(scenario.repository ? { repository: scenario.repository } : {}),
      scenarioPath: scenario.sourcePath,
      scenarioSha256: scenario.sha256,
    };
  }
  try {
    return JSON.parse(
      await readFile(
        path.join(fixturePath, ".arkline-performance-fixture.json"),
        "utf8",
      ),
    );
  } catch (error) {
    return { error: String(error) };
  }
}

function telemetryEvidence(
  snapshot,
  durations,
  eventTimings,
  interactionTimings,
) {
  return {
    errors: snapshot.errors,
    capabilities: snapshot.capabilities,
    eventTimingSummary: eventTimings,
    interactionTimingSummary: interactionTimings,
    frameGapSummary: summarizeSamples(snapshot.frameGaps),
    longAnimationFrameSummary: summarizeSamples(durations.longAnimationFrames),
    longAnimationFrameBlockingSummary: summarizeSamples(
      durations.longAnimationFrameBlocking,
    ),
    longTaskSummary: summarizeSamples(snapshot.longTasks),
    errorCount: snapshot.errorCount ?? snapshot.errors.length,
    expectedInterruptionCount: snapshot.expectedInterruptionCount ?? 0,
    eventTimingCount: snapshot.eventTimingCount ?? 0,
    eventTimingSamplingComplete: Boolean(snapshot.eventTimingSamplingComplete),
    frameGapCount: snapshot.frameGapCount ?? snapshot.frameGaps.length,
    longAnimationFrameCount: snapshot.longAnimationFrameCount ?? 0,
    longTaskCount: snapshot.longTaskCount ?? snapshot.longTasks.length,
    frames: snapshot.frames,
    scriptAttributions: [...(snapshot.scriptAttributions ?? [])]
      .sort((left, right) => right.totalDuration - left.totalDuration)
      .slice(0, 20),
    renderPressure: snapshot.renderPressure ?? null,
    ipcLatencySamples: snapshot.ipcLatencySamples ?? [],
    interactionTraces: summarizeInteractionTraces(snapshot.interactionTraces ?? []),
  };
}

function summarizeInteractionTraces(traces) {
  const completed = traces.filter((trace) => Number.isFinite(trace.durationMs));
  const statusCounts = {};
  for (const trace of traces) {
    statusCounts[trace.status] = (statusCounts[trace.status] ?? 0) + 1;
  }
  return {
    count: traces.length,
    statusCounts,
    slowest: [...completed]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 20),
  };
}

function countPendingDocumentLoads(traces) {
  return traces.filter(
    (trace) => trace.kind === "openFile" && trace.status === "running",
  ).length;
}

function causalTraceMetrics(traces) {
  const groups = new Set(traces.map((trace) => causalTraceGroup(trace.kind)).filter(Boolean));
  return {
    causalTraceCount: traces.length,
    causalTraceErrorCount: traces.filter((trace) => trace.status === "error").length,
    causalTraceRunningCount: traces.filter((trace) => trace.status === "running").length,
    causalTraceKindCount: groups.size,
  };
}

function successfulTraceDurations(traces, kind) {
  return traces
    .filter((trace) => (
      trace.kind === kind
      && trace.status === "ok"
      && Number.isFinite(trace.durationMs)
    ))
    .map((trace) => trace.durationMs);
}

function causalTraceGroup(kind) {
  if (kind === "editorInput") return "input";
  if (kind === "searchEverywhere" || kind === "text" || kind === "quickOpen") return "search";
  if (kind === "navigation" || kind === "openFile" || kind === "editorSwitch") return "navigation";
  return null;
}

function platformEvidence() {
  return {
    os: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    node: process.version,
    runnerImage: process.env.ImageVersion ?? null,
  };
}

function ciEvidence() {
  return {
    commit: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  };
}

function numericSamples(samples, key) {
  return samples.map((sample) => sample[key]).filter(Number.isFinite);
}

function fieldGrowth(first, last, key) {
  return Math.max(0, (last[key] ?? 0) - (first[key] ?? 0));
}

function growth(samples) {
  if (samples.length < 2) return 0;
  return Math.max(0, samples.at(-1) - samples[0]);
}

function steadySamples(samples) {
  return samples.slice(MEMORY_WARMUP_SAMPLE_COUNT);
}

function maximum(samples) {
  return Math.max(0, ...samples);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
