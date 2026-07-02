import type { BuildState } from "@/features/build/build-model";

export type BuildPipelineStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export type BuildPipelineStep = {
  id: "preflight" | "clean" | "build" | "diagnostics" | "artifacts";
  label: string;
  status: BuildPipelineStepStatus;
};

function step(id: BuildPipelineStep["id"], label: string, status: BuildPipelineStepStatus): BuildPipelineStep {
  return { id, label, status };
}

export function deriveBuildPipelineSteps(state: BuildState): BuildPipelineStep[] {
  if (state.preflight && !state.preflight.canBuild) {
    return [
      step("preflight", "Preflight", "failed"),
      step("clean", "Clean", "skipped"),
      step("build", "Build", "skipped"),
      step("diagnostics", "Diagnostics", "skipped"),
      step("artifacts", "Artifacts", "skipped"),
    ];
  }

  if (state.status === "running" && state.currentRun) {
    const clean = state.currentRun.intent.clean;
    return [
      step("preflight", "Preflight", "complete"),
      step("clean", "Clean", clean ? "running" : "skipped"),
      step("build", "Build", clean ? "pending" : "running"),
      step("diagnostics", "Diagnostics", "pending"),
      step("artifacts", "Artifacts", "pending"),
    ];
  }

  if (!state.lastResult) {
    return [];
  }

  const clean = state.lastResult.environment?.clean ?? state.currentRun?.intent.clean ?? false;
  const buildStatus = state.lastResult.status === "success" ? "complete"
    : state.lastResult.status === "stopped" ? "skipped"
    : "failed";
  const diagnosticsStatus = state.lastResult.diagnostics.length > 0 || state.lastResult.status !== "success"
    ? "complete"
    : "complete";
  const artifactsStatus = state.lastResult.artifacts.length > 0 ? "complete" : "skipped";

  return [
    step("preflight", "Preflight", "complete"),
    step("clean", "Clean", clean ? "complete" : "skipped"),
    step("build", "Build", buildStatus),
    step("diagnostics", "Diagnostics", diagnosticsStatus),
    step("artifacts", "Artifacts", artifactsStatus),
  ];
}

export function buildPipelineStatusLabel(status: BuildPipelineStepStatus): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "pending":
    default:
      return "Pending";
  }
}
