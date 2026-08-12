import path from "node:path";

export const PACKAGED_SOAK_LIMITS = Object.freeze({
  rendererSearchP95Ms: 300,
  rendererJumpP95Ms: 300,
  rendererEditorInputP95Ms: 50,
  rendererEditorScrollP95Ms: 50,
  rendererDefinitionP95Ms: 200,
  rendererCompletionP95Ms: 150,
  rendererSearchP99Ms: 750,
  rendererJumpP99Ms: 750,
  rendererEditorInputP99Ms: 100,
  rendererEditorScrollP99Ms: 100,
  interactionTimingP95Ms: 100,
  maximumLongTaskMs: 500,
  rssGrowthBytes: 512 * 1024 * 1024,
  privateGrowthBytes: 512 * 1024 * 1024,
  jsHeapGrowthBytes: 256 * 1024 * 1024,
  walGrowthBytes: 128 * 1024 * 1024,
  minimumSteadyMemorySamples: 5,
});

export function parsePackagedSoakArguments(argv = process.argv.slice(2)) {
  const applicationPath = requiredArgument(argv, "--application");
  const fixturePath = requiredArgument(argv, "--fixture");
  const mode = argumentValue(argv, "--mode") ?? "soak";
  if (!["smoke", "soak"].includes(mode)) {
    throw new Error("mode must be smoke or soak");
  }
  const defaultDurationMinutes = mode === "smoke" ? 2 : 30;
  const durationMinutes = Number(
    argumentValue(argv, "--duration-minutes") ?? defaultDurationMinutes,
  );
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("duration-minutes must be a positive number");
  }
  const coreIndexTimeoutMinutes = Number(
    argumentValue(argv, "--core-index-timeout-minutes") ?? 5,
  );
  if (!Number.isFinite(coreIndexTimeoutMinutes) || coreIndexTimeoutMinutes <= 0) {
    throw new Error("core-index-timeout-minutes must be a positive number");
  }
  return {
    mode,
    applicationPath: path.resolve(applicationPath),
    fixturePath: path.resolve(fixturePath),
    scenarioPath: optionalResolvedPath(argumentValue(argv, "--scenario")),
    sdkPath: optionalResolvedPath(argumentValue(argv, "--sdk")),
    durationMs: durationMinutes * 60_000,
    coreIndexTimeoutMs: coreIndexTimeoutMinutes * 60_000,
    maxCycles: mode === "smoke" ? 1 : Number.POSITIVE_INFINITY,
    reportPath: path.resolve(
      argumentValue(argv, "--report") ?? "artifacts/packaged-soak.json",
    ),
    strict: argv.includes("--strict"),
    driverPath: argumentValue(argv, "--driver") ?? "msedgedriver",
  };
}

function optionalResolvedPath(value) {
  return value ? path.resolve(value) : null;
}

export function summarizeSamples(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

export function evaluateSoakReport(metrics, limits = PACKAGED_SOAK_LIMITS) {
  const failures = [];
  if (metrics.crashCount > 0) failures.push("app-or-editor-crash");
  if (metrics.unresponsiveCount > 0) failures.push("webdriver-unresponsive");
  if (metrics.pendingLoads > 0) failures.push("pending-document-loads");
  if (metrics.staleApplyCount > 0) failures.push("stale-result-applied");
  if (metrics.searchMissCount > 0) failures.push("search-result-miss");
  if (metrics.editorInteractionFailureCount > 0) {
    failures.push("editor-interaction-failure");
  }
  if (metrics.workerRestartGrowth > 0) failures.push("worker-restart");
  const expectedContentFileCount = metrics.eligibleContentFileCount
    ?? metrics.indexedFileCount;
  if (metrics.indexedContentFileCount < expectedContentFileCount) {
    failures.push("incomplete-content-index");
  }
  if (metrics.coreIndexCoverageVerified === false) {
    failures.push("unverified-content-index-coverage");
  }
  if (metrics.backgroundIndexProgressObserved === false) {
    failures.push("no-background-index-progress");
  }
  if (metrics.stalledIndexTaskCount > 0) failures.push("stalled-index-task");
  if (metrics.rendererSearchP95Ms > limits.rendererSearchP95Ms) {
    failures.push("renderer-search-p95");
  }
  if (metrics.rendererJumpP95Ms > limits.rendererJumpP95Ms) {
    failures.push("renderer-jump-p95");
  }
  if (metrics.rendererEditorInputP95Ms > limits.rendererEditorInputP95Ms) {
    failures.push("renderer-editor-input-p95");
  }
  if (metrics.rendererEditorScrollP95Ms > limits.rendererEditorScrollP95Ms) {
    failures.push("renderer-editor-scroll-p95");
  }
  if (metrics.rendererSearchP99Ms > limits.rendererSearchP99Ms) {
    failures.push("renderer-search-p99");
  }
  if (metrics.rendererJumpP99Ms > limits.rendererJumpP99Ms) {
    failures.push("renderer-jump-p99");
  }
  if (metrics.rendererEditorInputP99Ms > limits.rendererEditorInputP99Ms) {
    failures.push("renderer-editor-input-p99");
  }
  if (metrics.rendererEditorScrollP99Ms > limits.rendererEditorScrollP99Ms) {
    failures.push("renderer-editor-scroll-p99");
  }
  appendSemanticFailures(failures, metrics, limits);
  if (!metrics.eventTimingSupported) failures.push("missing-event-timing");
  if (!metrics.longAnimationFrameSupported) {
    failures.push("missing-long-animation-frame");
  }
  if (!(metrics.interactionTimingCount > 0)) {
    failures.push("no-interaction-timing-evidence");
  }
  if (metrics.interactionTimingP95Ms > limits.interactionTimingP95Ms) {
    failures.push("interaction-timing-p95");
  }
  if (metrics.longTaskMaxMs > limits.maximumLongTaskMs) {
    failures.push("renderer-long-task-max");
  }
  appendCausalTraceFailures(failures, metrics);
  if (metrics.rssGrowthBytes > limits.rssGrowthBytes) failures.push("rss-growth");
  if (metrics.privateGrowthBytes > limits.privateGrowthBytes) {
    failures.push("private-memory-growth");
  }
  if (metrics.jsHeapGrowthBytes > limits.jsHeapGrowthBytes) {
    failures.push("js-heap-growth");
  }
  if (metrics.walGrowthBytes > limits.walGrowthBytes) failures.push("wal-growth");
  if (metrics.sharedSdkWalGrowthBytes > limits.walGrowthBytes) {
    failures.push("shared-sdk-wal-growth");
  }
  if (metrics.successfulSearchCount === 0) failures.push("no-search-result");
  if (metrics.successfulJumpCount === 0) failures.push("no-navigation");
  if (metrics.successfulEditorInputCount === 0) {
    failures.push("no-editor-input-evidence");
  }
  if (metrics.successfulEditorScrollCount === 0) {
    failures.push("no-editor-scroll-evidence");
  }
  if (metrics.processTreeSampleCount === 0) {
    failures.push("no-process-tree-evidence");
  }
  if (!(metrics.steadyProcessSampleCount >= limits.minimumSteadyMemorySamples)) {
    failures.push("insufficient-steady-memory-evidence");
  }
  return { passed: failures.length === 0, failures, limits };
}

export function evaluateSmokeReport(metrics) {
  const failures = [];
  if (metrics.crashCount > 0) failures.push("app-or-editor-crash");
  if (metrics.unresponsiveCount > 0) failures.push("webdriver-unresponsive");
  if (metrics.staleApplyCount > 0) failures.push("stale-result-applied");
  if (metrics.editorInteractionFailureCount > 0) {
    failures.push("editor-interaction-failure");
  }
  if (metrics.successfulSearchCount === 0) failures.push("no-search-result");
  if (metrics.successfulJumpCount === 0) failures.push("no-navigation");
  if (metrics.successfulEditorInputCount === 0) {
    failures.push("no-editor-input-evidence");
  }
  if (metrics.successfulEditorScrollCount === 0) {
    failures.push("no-editor-scroll-evidence");
  }
  if (!metrics.eventTimingSupported) failures.push("missing-event-timing");
  if (!metrics.longAnimationFrameSupported) {
    failures.push("missing-long-animation-frame");
  }
  appendCausalTraceFailures(failures, metrics);
  if (metrics.processTreeSampleCount === 0) {
    failures.push("no-process-tree-evidence");
  }
  appendSemanticFailures(failures, metrics, PACKAGED_SOAK_LIMITS);
  return { passed: failures.length === 0, failures };
}

function appendCausalTraceFailures(failures, metrics) {
  if (!(metrics.causalTraceCount > 0)) failures.push("no-causal-interaction-traces");
  if ((metrics.causalTraceErrorCount ?? 0) > 0) failures.push("causal-trace-error");
  if ((metrics.causalTraceRunningCount ?? 0) > 0) failures.push("causal-trace-left-running");
  if ((metrics.causalTraceKindCount ?? 0) < 3) failures.push("incomplete-causal-trace-coverage");
}

function appendSemanticFailures(failures, metrics, limits) {
  if (!metrics.semanticRequired) return;
  if (metrics.definitionMissCount > 0) failures.push("definition-result-miss");
  if (metrics.completionMissCount > 0) failures.push("completion-result-miss");
  if (metrics.successfulDefinitionCount === 0) {
    failures.push("no-definition-evidence");
  }
  if (metrics.successfulCompletionCount === 0) {
    failures.push("no-member-completion-evidence");
  }
  if (metrics.rendererDefinitionP95Ms > limits.rendererDefinitionP95Ms) {
    failures.push("renderer-definition-p95");
  }
  if (metrics.rendererCompletionP95Ms > limits.rendererCompletionP95Ms) {
    failures.push("renderer-completion-p95");
  }
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return rounded(sorted[Math.max(0, index)]);
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function requiredArgument(argv, name) {
  const value = argumentValue(argv, name);
  if (!value) throw new Error(`${name.slice(2)} is required`);
  return value;
}

function argumentValue(argv, name) {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}
