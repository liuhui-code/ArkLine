import { assessBuildFreshness, unknownBuildFreshness } from "@/features/build/build-freshness";
import type { BuildQueueItem, BuildResult, BuildState, HarmonyBuildPlan } from "@/features/build/build-model";

export function createBuildStore() {
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
    freshness: unknownBuildFreshness,
    lastExitCode: null,
    lastDurationMs: null,
    message: "No build run yet",
  };

  return {
    state,
    configure(next: Partial<Pick<BuildState, "lastTarget" | "moduleName" | "products" | "product" | "buildMode" | "fastMode">>) {
      Object.assign(state, next);
    },
    enqueue(item: BuildQueueItem) {
      state.queue = [...state.queue.filter((queued) => queued.runId !== item.runId), item];
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
      state.currentRun = null;
    },
    fail(message: string) {
      state.status = "failed";
      state.message = message;
      state.currentRun = null;
    },
  };
}
