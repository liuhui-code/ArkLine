import type { BuildEnvironmentSnapshot, BuildPlan, BuildToolchainSnapshot } from "@/features/build/build-model";
import type { AppSettings } from "@/features/settings/settings-store";

export type BuildEnvironmentSnapshotInput = {
  plan: BuildPlan;
  settings?: AppSettings["sdk"] | null;
};

const emptyToolchainSnapshot: BuildToolchainSnapshot = {
  harmonySdkPath: "",
  semanticWorkerPath: "",
  nodePath: "",
  autoDetect: true,
};

export function createBuildEnvironmentSnapshot(input: BuildEnvironmentSnapshotInput): BuildEnvironmentSnapshot {
  const toolchain = input.settings
    ? {
      harmonySdkPath: input.settings.harmonySdkPath.trim(),
      semanticWorkerPath: input.settings.semanticWorkerPath.trim(),
      nodePath: input.settings.nodePath.trim(),
      autoDetect: input.settings.autoDetect,
    }
    : emptyToolchainSnapshot;

  return {
    projectRoot: input.plan.intent.projectRoot,
    cwd: input.plan.cwd,
    command: input.plan.command,
    target: input.plan.intent.target,
    scope: input.plan.intent.scope,
    moduleName: input.plan.intent.moduleName,
    product: input.plan.intent.product,
    buildMode: input.plan.intent.buildMode,
    clean: input.plan.intent.clean,
    fastMode: input.plan.intent.fastMode,
    toolchain,
  };
}
