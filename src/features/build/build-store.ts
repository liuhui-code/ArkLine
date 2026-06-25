import { assessBuildFreshness, unknownBuildFreshness } from "@/features/build/build-freshness";
import type { BuildEvent, BuildQueueItem, BuildResult, BuildState, HarmonyBuildPlan } from "@/features/build/build-model";

export function createBuildStore() {
  let nextEventSequence = 0;
  const state: BuildState = {
    status: "idle",
    currentRun: null,
    lastTarget: "hap",
    moduleName: "entry",
    products: ["default"],
    product: "default",
    buildMode: "debug",
    fastMode: false,
    output: "",
    problems: [],
    lastResult: null,
    history: [],
    queue: [],
    events: [],
    freshness: unknownBuildFreshness,
    lastExitCode: null,
    lastDurationMs: null,
    message: "No build run yet",
  };

  function appendEvent(event: Omit<BuildEvent, "sequence">) {
    const nextEvent = {
      ...event,
      sequence: ++nextEventSequence,
    };
    state.events = [...state.events, nextEvent].slice(-200);
    return nextEvent;
  }

  return {
    state,
    configure(next: Partial<Pick<BuildState, "lastTarget" | "moduleName" | "products" | "product" | "buildMode" | "fastMode">>) {
      Object.assign(state, next);
    },
    appendEvent,
    eventsForRun(runId: string) {
      return state.events.filter((event) => event.runId === runId);
    },
    clearEvents(runId?: string) {
      state.events = runId ? state.events.filter((event) => event.runId !== runId) : [];
    },
    enqueue(item: BuildQueueItem) {
      state.queue = [...state.queue.filter((queued) => queued.runId !== item.runId), item];
      appendEvent({
        runId: item.runId,
        kind: "queued",
        message: `Queued ${item.plan.label}`,
      });
    },
    dequeueNext() {
      const [next, ...remaining] = state.queue;
      state.queue = remaining;
      return next ?? null;
    },
    clearQueue() {
      state.queue = [];
    },
    start(plan: HarmonyBuildPlan & { runId: string }) {
      state.status = "running";
      state.currentRun = plan;
      appendEvent({
        runId: plan.runId,
        kind: "started",
        message: plan.label,
      });
      state.freshness = assessBuildFreshness({
        plan,
        history: state.history,
      });
      state.output = "";
      state.problems = [];
      state.lastResult = null;
      state.lastExitCode = null;
      state.message = plan.label;
    },
    finish(result: BuildResult) {
      state.status = result.status;
      state.output = result.output;
      state.problems = result.diagnostics;
      state.lastResult = result;
      state.history = [result, ...state.history.filter((item) => item.runId !== result.runId)].slice(0, 20);
      state.lastExitCode = result.exitCode;
      state.lastDurationMs = result.durationMs;
      state.message = state.status === "success" ? "Build succeeded" : state.status === "stopped" ? "Build stopped" : "Build failed";
      if (result.diagnostics.length > 0) {
        appendEvent({
          runId: result.runId,
          kind: "diagnostics",
          message: `${result.diagnostics.length} build diagnostic${result.diagnostics.length === 1 ? "" : "s"}`,
          diagnosticCount: result.diagnostics.length,
        });
      }
      if (result.artifacts.length > 0) {
        appendEvent({
          runId: result.runId,
          kind: "artifacts",
          message: `${result.artifacts.length} build artifact${result.artifacts.length === 1 ? "" : "s"}`,
          artifactPaths: result.artifacts.map((artifact) => artifact.path),
        });
      }
      appendEvent({
        runId: result.runId,
        kind: "finished",
        message: state.message,
        status: result.status,
      });
      state.currentRun = null;
    },
    fail(message: string) {
      state.status = "failed";
      state.message = message;
      if (state.currentRun?.runId) {
        appendEvent({
          runId: state.currentRun.runId,
          kind: "failed",
          message,
          status: "failed",
        });
      }
      state.currentRun = null;
    },
  };
}
