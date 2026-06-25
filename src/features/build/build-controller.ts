import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import type { BuildPlan, BuildResult, BuildState } from "@/features/build/build-model";
import { parseBuildProblems } from "@/features/build/build-output-parser";
import { createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
import type { AppSettings } from "@/features/settings/settings-store";
import type { TerminalRunRequest, TerminalRunResult } from "@/features/workspace/workspace-api";

export type BuildPlanFromStateInput = {
  rootPath: string;
  state: Pick<BuildState, "lastTarget" | "moduleName" | "product" | "buildMode" | "fastMode">;
  clean: boolean;
};

export type TerminalBuildRunner = (request: TerminalRunRequest) => Promise<TerminalRunResult>;

export function createHarmonyBuildPlanFromState(input: BuildPlanFromStateInput): BuildPlan {
  const target = input.state.lastTarget;

  return planHarmonyBuildCommand({
    rootPath: input.rootPath,
    target,
    moduleName: target === "app" ? null : input.state.moduleName,
    product: input.state.product,
    buildMode: input.state.buildMode,
    clean: input.clean,
    fastMode: input.state.fastMode,
  });
}

export async function executeHarmonyBuildPlan(input: {
  runId: string;
  plan: BuildPlan;
  runTerminalCommand: TerminalBuildRunner;
  settings?: AppSettings["sdk"] | null;
}): Promise<BuildResult> {
  const terminalResult = await input.runTerminalCommand({
    runId: input.runId,
    command: input.plan.command,
    cwd: input.plan.cwd,
    source: "preset",
  });
  const output = [terminalResult.stdout, terminalResult.stderr].filter(Boolean).join("\n");
  const problems = parseBuildProblems(output);

  return createBuildResultFromTerminalRun({
    ...terminalResult,
    planId: input.plan.id,
    problems,
    environment: createBuildEnvironmentSnapshot({
      plan: input.plan,
      settings: input.settings,
    }),
  });
}
