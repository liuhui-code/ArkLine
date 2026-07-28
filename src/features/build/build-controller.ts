import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { extractBuildArtifacts } from "@/features/build/build-artifacts";
import { parseBuildDiagnostics, type BuildDiagnosticMatcher } from "@/features/build/build-diagnostics";
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import { createBuildToolchainEnvironment } from "@/features/build/build-toolchain-environment";
import type { BuildEnvironmentResolution, BuildPlan, BuildResult, BuildState, HarmonyBuildProject } from "@/features/build/build-model";
import { createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
import type { AppSettings } from "@/features/settings/settings-store";
import type { TerminalRunRequest, TerminalRunResult } from "@/features/workspace/workspace-api";

export type BuildPlanFromStateInput = {
  rootPath: string;
  state: Pick<BuildState, "lastTarget" | "moduleName" | "product" | "buildMode" | "fastMode">;
  clean: boolean;
  project?: HarmonyBuildProject | null;
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
    wrapperCommand: input.project?.hvigorWrapperCommand,
  });
}

export async function executeHarmonyBuildPlan(input: {
  runId: string;
  plan: BuildPlan;
  runTerminalCommand: TerminalBuildRunner;
  settings?: AppSettings["sdk"] | null;
  toolchain?: BuildEnvironmentResolution | null;
  diagnosticMatchers?: BuildDiagnosticMatcher[];
}): Promise<BuildResult> {
  const toolchain = input.toolchain ?? createBuildToolchainEnvironment(input.settings);
  const runs: TerminalRunResult[] = [];
  for (const step of input.plan.steps) {
    const terminalResult = await input.runTerminalCommand({
      runId: input.runId,
      command: step.command,
      program: step.program,
      args: step.args,
      cwd: input.plan.cwd,
      source: "preset",
      ...toolchain,
    });
    runs.push(terminalResult);
    if (terminalResult.exitCode !== 0 || terminalResult.stopped) {
      break;
    }
  }
  const terminalResult = combineTerminalRuns(input.runId, input.plan.command, runs);
  const output = [terminalResult.stdout, terminalResult.stderr].filter(Boolean).join("\n");
  const problems = parseBuildDiagnostics(output, input.diagnosticMatchers);
  const artifacts = extractBuildArtifacts(output);

  return createBuildResultFromTerminalRun({
    ...terminalResult,
    planId: input.plan.id,
    problems,
    artifacts,
    environment: createBuildEnvironmentSnapshot({
      plan: input.plan,
      settings: input.settings,
    }),
  });
}

function combineTerminalRuns(runId: string, command: string, runs: TerminalRunResult[]): TerminalRunResult {
  const last = runs[runs.length - 1];
  return {
    runId,
    command,
    stdout: runs.map((run) => run.stdout).filter(Boolean).join("\n"),
    stderr: runs.map((run) => run.stderr).filter(Boolean).join("\n"),
    exitCode: last?.exitCode ?? null,
    durationMs: runs.reduce((total, run) => total + run.durationMs, 0),
    stopped: runs.some((run) => run.stopped),
  };
}
