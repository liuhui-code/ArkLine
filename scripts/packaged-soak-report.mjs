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

const MEMORY_WARMUP_SAMPLE_COUNT = 4;

export function buildPackagedSoakReport(input) {
  const automationDispatch = summarizeSamples(
    input.automationDispatchSamples ?? input.interactionSamples ?? [],
  );
  const searchReady = summarizeSamples(input.searchReadySamples);
  const jumps = summarizeSamples(input.jumpSamples);
  const validProcessSamples = input.processSamples.filter(
    (sample) => sample.processCount > 0,
  );
  const rssSamples = numericSamples(validProcessSamples, "rssBytes");
  const privateSamples = numericSamples(validProcessSamples, "privateBytes");
  const usedHeapSamples = input.heapSamples
    .filter((sample) => sample.supported)
    .map((sample) => sample.usedBytes);
  const telemetry = telemetryDurations(input.telemetry);
  const firstDiagnostics = input.diagnostics.find((item) => !item.error) ?? {};
  const lastDiagnostics = [...input.diagnostics]
    .reverse()
    .find((item) => !item.error) ?? {};
  const eventTimings = summarizeSamples(telemetry.eventTimings);
  const interactionTimings = summarizeSamples(telemetry.interactionTimings);
  const steadyRssSamples = steadySamples(rssSamples);
  const steadyPrivateSamples = steadySamples(privateSamples);
  const steadyHeapSamples = steadySamples(usedHeapSamples);
  const verdictMetrics = {
    rendererSearchP95Ms: searchReady.p95Ms,
    rendererJumpP95Ms: jumps.p95Ms,
    crashCount: input.counters.crashCount,
    unresponsiveCount: input.counters.unresponsiveCount,
    pendingLoads: lastDiagnostics.queuePending ?? 0,
    staleApplyCount: input.counters.staleApplyCount,
    searchMissCount: input.counters.searchMissCount,
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
    eventTimingSupported: Boolean(input.telemetry.capabilities?.eventTiming),
    longAnimationFrameSupported: Boolean(
      input.telemetry.capabilities?.longAnimationFrame,
    ),
    interactionTimingCount: interactionTimings.count,
    interactionTimingP95Ms: interactionTimings.p95Ms,
    jsHeapGrowthBytes: growth(steadyHeapSamples),
    processTreeSampleCount: validProcessSamples.length,
    steadyProcessSampleCount: Math.min(
      steadyRssSamples.length,
      steadyPrivateSamples.length,
    ),
    indexedFileCount: lastDiagnostics.fileCount ?? 0,
    indexedContentFileCount: lastDiagnostics.contentFileCount ?? 0,
    stalledIndexTaskCount: (lastDiagnostics.taskStatuses ?? []).filter(
      (status) => status.status === "running" && status.stalled,
    ).length,
  };
  const verdict = input.options.mode === "smoke"
    ? evaluateSmokeReport(verdictMetrics)
    : evaluateSoakReport(verdictMetrics);
  return {
    schemaVersion: 3,
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
    telemetry: telemetryEvidence(
      input.telemetry,
      telemetry,
      eventTimings,
      interactionTimings,
    ),
    diagnostics: input.diagnostics,
    processSamples: input.processSamples,
    heapSamples: input.heapSamples,
    searchEvidence: input.searchEvidence ?? [],
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
    },
    verdict,
  };
}

export function buildPackagedSoakFailureReport(input) {
  return {
    schemaVersion: 3,
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

export async function inspectFixture(fixturePath) {
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
    eventTimingCount: snapshot.eventTimingCount ?? 0,
    frameGapCount: snapshot.frameGapCount ?? snapshot.frameGaps.length,
    longAnimationFrameCount: snapshot.longAnimationFrameCount ?? 0,
    longTaskCount: snapshot.longTaskCount ?? snapshot.longTasks.length,
    frames: snapshot.frames,
    scriptAttributions: [...(snapshot.scriptAttributions ?? [])]
      .sort((left, right) => right.totalDuration - left.totalDuration)
      .slice(0, 20),
    renderPressure: snapshot.renderPressure ?? null,
    ipcLatencySamples: snapshot.ipcLatencySamples ?? [],
  };
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
