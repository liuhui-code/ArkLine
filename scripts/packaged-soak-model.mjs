import path from "node:path";

export const PACKAGED_SOAK_LIMITS = Object.freeze({
  interactionP95Ms: 100,
  interactionP99Ms: 250,
  eventTimingP95Ms: 100,
  rssGrowthBytes: 512 * 1024 * 1024,
  privateGrowthBytes: 512 * 1024 * 1024,
  jsHeapGrowthBytes: 256 * 1024 * 1024,
  walGrowthBytes: 128 * 1024 * 1024,
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
  return {
    mode,
    applicationPath: path.resolve(applicationPath),
    fixturePath: path.resolve(fixturePath),
    durationMs: durationMinutes * 60_000,
    maxCycles: mode === "smoke" ? 1 : Number.POSITIVE_INFINITY,
    reportPath: path.resolve(
      argumentValue(argv, "--report") ?? "artifacts/packaged-soak.json",
    ),
    strict: argv.includes("--strict"),
    driverPath: argumentValue(argv, "--driver") ?? "msedgedriver",
  };
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
  if (metrics.workerRestartGrowth > 0) failures.push("worker-restart");
  if (metrics.interactionP95Ms > limits.interactionP95Ms) {
    failures.push("interaction-p95");
  }
  if (metrics.interactionP99Ms > limits.interactionP99Ms) {
    failures.push("interaction-p99");
  }
  if (!metrics.eventTimingSupported) failures.push("missing-event-timing");
  if (!metrics.longAnimationFrameSupported) {
    failures.push("missing-long-animation-frame");
  }
  if (metrics.eventTimingP95Ms > limits.eventTimingP95Ms) {
    failures.push("event-timing-p95");
  }
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
  if (metrics.processTreeSampleCount === 0) {
    failures.push("no-process-tree-evidence");
  }
  return { passed: failures.length === 0, failures, limits };
}

export function evaluateSmokeReport(metrics) {
  const failures = [];
  if (metrics.crashCount > 0) failures.push("app-or-editor-crash");
  if (metrics.unresponsiveCount > 0) failures.push("webdriver-unresponsive");
  if (metrics.staleApplyCount > 0) failures.push("stale-result-applied");
  if (metrics.successfulSearchCount === 0) failures.push("no-search-result");
  if (metrics.successfulJumpCount === 0) failures.push("no-navigation");
  if (!metrics.eventTimingSupported) failures.push("missing-event-timing");
  if (!metrics.longAnimationFrameSupported) {
    failures.push("missing-long-animation-frame");
  }
  if (metrics.processTreeSampleCount === 0) {
    failures.push("no-process-tree-evidence");
  }
  return { passed: failures.length === 0, failures };
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
