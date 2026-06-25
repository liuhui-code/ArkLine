import type { BuildEvent, BuildQueueItem, BuildResult, BuildState, BuildTarget } from "@/features/build/build-model";

export type BuildRunSummaryStatus = "queued" | "running" | BuildResult["status"];

export type BuildRunSummary = {
  runId: string;
  label: string;
  status: BuildRunSummaryStatus;
  target: BuildTarget | "unknown";
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  durationMs: number | null;
  diagnosticCount: number;
  artifactCount: number;
  artifactPaths: string[];
  eventCount: number;
};

function eventsForRun(events: BuildEvent[], runId: string) {
  return events.filter((event) => event.runId === runId);
}

function summaryFromQueueItem(item: BuildQueueItem, events: BuildEvent[]): BuildRunSummary {
  return {
    runId: item.runId,
    label: item.plan.label,
    status: "queued",
    target: item.plan.intent.target,
    moduleName: item.plan.intent.moduleName,
    product: item.plan.intent.product,
    buildMode: item.plan.intent.buildMode,
    durationMs: null,
    diagnosticCount: 0,
    artifactCount: 0,
    artifactPaths: [],
    eventCount: eventsForRun(events, item.runId).length,
  };
}

function summaryFromCurrentRun(state: BuildState): BuildRunSummary | null {
  if (!state.currentRun?.runId) {
    return null;
  }

  return {
    runId: state.currentRun.runId,
    label: state.currentRun.label,
    status: "running",
    target: state.currentRun.intent.target,
    moduleName: state.currentRun.intent.moduleName,
    product: state.currentRun.intent.product,
    buildMode: state.currentRun.intent.buildMode,
    durationMs: null,
    diagnosticCount: 0,
    artifactCount: 0,
    artifactPaths: [],
    eventCount: eventsForRun(state.events, state.currentRun.runId).length,
  };
}

function summaryFromResult(result: BuildResult, events: BuildEvent[]): BuildRunSummary {
  return {
    runId: result.runId,
    label: result.environment
      ? `Build ${result.environment.target.toUpperCase()} ${result.environment.moduleName ?? "project"} ${result.environment.buildMode}`
      : `Build ${result.runId}`,
    status: result.status,
    target: result.environment?.target ?? "unknown",
    moduleName: result.environment?.moduleName ?? null,
    product: result.environment?.product ?? "default",
    buildMode: result.environment?.buildMode ?? "debug",
    durationMs: result.durationMs,
    diagnosticCount: result.diagnostics.length,
    artifactCount: result.artifacts.length,
    artifactPaths: result.artifacts.map((artifact) => artifact.path),
    eventCount: eventsForRun(events, result.runId).length,
  };
}

export function listBuildRunSummaries(state: BuildState): BuildRunSummary[] {
  const summaries: BuildRunSummary[] = [];
  const current = summaryFromCurrentRun(state);
  if (current) {
    summaries.push(current);
  }

  state.queue.forEach((item) => {
    summaries.push(summaryFromQueueItem(item, state.events));
  });

  state.history.forEach((result) => {
    if (result.runId !== state.currentRun?.runId) {
      summaries.push(summaryFromResult(result, state.events));
    }
  });

  return summaries;
}
