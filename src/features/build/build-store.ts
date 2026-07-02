import { assessBuildFreshness, unknownBuildFreshness } from "@/features/build/build-freshness";
import { copyBuildConfiguration, createBuildConfiguration } from "@/features/build/build-configuration";
import type {
  BuildEvent,
  BuildConfiguration,
  BuildPreflightResult,
  BuildQueueItem,
  BuildResult,
  BuildState,
  HarmonyBuildPlan,
} from "@/features/build/build-model";

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
    configurations: [],
    activeConfigurationId: null,
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
    preflight: null,
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
    saveCurrentConfiguration() {
      const configuration = createBuildConfiguration(state);
      state.configurations = [
        ...state.configurations.filter((item) => item.id !== configuration.id),
        configuration,
      ];
      state.activeConfigurationId = configuration.id;
      state.message = `Saved build configuration: ${configuration.name}`;
    },
    loadConfigurations(configurations: BuildConfiguration[]) {
      state.configurations = configurations;
      if (state.activeConfigurationId && !configurations.some((item) => item.id === state.activeConfigurationId)) {
        state.activeConfigurationId = null;
      }
    },
    copyActiveConfiguration() {
      const configuration = state.configurations.find((item) => item.id === state.activeConfigurationId);
      if (!configuration) {
        return;
      }
      const copy = copyBuildConfiguration(configuration, state.configurations);
      state.configurations = [...state.configurations, copy];
      state.activeConfigurationId = copy.id;
      state.lastTarget = copy.target;
      state.moduleName = copy.moduleName;
      state.product = copy.product;
      state.buildMode = copy.buildMode;
      state.fastMode = copy.fastMode;
      state.message = `Copied build configuration: ${copy.name}`;
    },
    deleteActiveConfiguration() {
      if (!state.activeConfigurationId) {
        return;
      }
      const removed = state.configurations.find((item) => item.id === state.activeConfigurationId);
      state.configurations = state.configurations.filter((item) => item.id !== state.activeConfigurationId);
      state.activeConfigurationId = null;
      if (removed) {
        state.message = `Deleted build configuration: ${removed.name}`;
      }
    },
    selectConfiguration(configurationId: string) {
      const configuration = state.configurations.find((item) => item.id === configurationId);
      if (!configuration) {
        return;
      }
      state.activeConfigurationId = configuration.id;
      state.lastTarget = configuration.target;
      state.moduleName = configuration.moduleName;
      state.product = configuration.product;
      state.buildMode = configuration.buildMode;
      state.fastMode = configuration.fastMode;
      state.message = `Selected build configuration: ${configuration.name}`;
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
      state.preflight = null;
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
      state.preflight = null;
    },
    failPreflight(result: BuildPreflightResult) {
      state.status = "failed";
      state.currentRun = null;
      state.lastResult = null;
      state.problems = [];
      state.preflight = result;
      state.lastExitCode = null;
      state.message = "Build preflight failed";
      state.output = result.issues.map((item) => `${item.severity.toUpperCase()}: ${item.message}\n${item.hint}`).join("\n\n");
    },
    fail(message: string) {
      state.status = "failed";
      state.message = message;
      state.preflight = null;
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
