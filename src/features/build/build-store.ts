import type { BuildRunFinish, BuildState, HarmonyBuildPlan } from "@/features/build/build-model";

export function createBuildStore() {
  const state: BuildState = {
    status: "idle",
    currentRun: null,
    lastTarget: "hap",
    moduleName: "entry",
    product: "default",
    buildMode: "debug",
    fastMode: false,
    output: "",
    problems: [],
    lastExitCode: null,
    lastDurationMs: null,
    message: "No build run yet",
  };

  return {
    state,
    configure(next: Partial<Pick<BuildState, "lastTarget" | "moduleName" | "product" | "buildMode" | "fastMode">>) {
      Object.assign(state, next);
    },
    start(plan: HarmonyBuildPlan & { runId: string }) {
      state.status = "running";
      state.currentRun = plan;
      state.output = "";
      state.problems = [];
      state.lastExitCode = null;
      state.message = plan.label;
    },
    finish(result: BuildRunFinish) {
      state.status = result.stopped ? "stopped" : result.exitCode === 0 ? "success" : "failed";
      state.output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      state.problems = result.problems;
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
