import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import type {
  BuildEnvironmentSnapshot,
  BuildFreshnessAssessment,
  BuildPlan,
  BuildResult,
} from "@/features/build/build-model";

export const unknownBuildFreshness: BuildFreshnessAssessment = {
  status: "unknown",
  reason: "no-history",
  artifactPaths: [],
};

function sameToolchain(left: BuildEnvironmentSnapshot["toolchain"], right: BuildEnvironmentSnapshot["toolchain"]) {
  return left.harmonySdkPath === right.harmonySdkPath
    && left.semanticWorkerPath === right.semanticWorkerPath
    && left.nodePath === right.nodePath
    && left.autoDetect === right.autoDetect;
}

function sameEnvironment(left: BuildEnvironmentSnapshot, right: BuildEnvironmentSnapshot) {
  return left.projectRoot === right.projectRoot
    && left.cwd === right.cwd
    && left.command === right.command
    && left.target === right.target
    && left.scope === right.scope
    && left.moduleName === right.moduleName
    && left.product === right.product
    && left.buildMode === right.buildMode
    && left.clean === right.clean
    && left.fastMode === right.fastMode
    && sameToolchain(left.toolchain, right.toolchain);
}

export function assessBuildFreshness(input: {
  plan: BuildPlan;
  history: BuildResult[];
  environment?: BuildEnvironmentSnapshot;
}): BuildFreshnessAssessment {
  const successful = input.history.filter((result) => result.status === "success");
  if (input.history.length === 0) {
    return unknownBuildFreshness;
  }

  if (successful.length === 0) {
    return {
      status: "unknown",
      reason: "no-successful-build",
      artifactPaths: [],
    };
  }

  const expectedEnvironment = input.environment ?? createBuildEnvironmentSnapshot({ plan: input.plan });
  const matching = successful.find((result) => result.environment && sameEnvironment(result.environment, expectedEnvironment));
  if (!matching) {
    const sameCommand = successful.some((result) => result.environment?.command === expectedEnvironment.command);
    return {
      status: "stale",
      reason: sameCommand ? "environment-changed" : "command-changed",
      artifactPaths: [],
    };
  }

  const artifactPaths = matching.artifacts.map((artifact) => artifact.path);
  if (artifactPaths.length === 0) {
    return {
      status: "unknown",
      reason: "artifacts-missing",
      matchingRunId: matching.runId,
      artifactPaths: [],
    };
  }

  return {
    status: "candidate-current",
    reason: "matching-success",
    matchingRunId: matching.runId,
    artifactPaths,
  };
}
