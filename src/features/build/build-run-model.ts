import type { BuildIntent, BuildResult, BuildTarget, HarmonyBuildRequest } from "@/features/build/build-model";
import type { ProblemItem } from "@/features/problems/problems-store";

export function createBuildIntent(request: HarmonyBuildRequest): BuildIntent {
  const product = request.product.trim() || "default";
  const scope = request.target === "app" ? "project" : "module";
  const moduleName = scope === "module"
    ? request.moduleName?.trim() || "entry"
    : null;

  return {
    kind: "build",
    projectRoot: request.rootPath,
    target: request.target,
    scope,
    moduleName,
    product,
    buildMode: request.buildMode,
    clean: request.clean,
    fastMode: request.fastMode,
  };
}

export function createBuildResultFromTerminalRun(input: {
  runId: string;
  planId?: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  problems: ProblemItem[];
  stopped?: boolean;
}): BuildResult {
  const status = input.stopped ? "stopped" : input.exitCode === 0 ? "success" : "failed";
  const output = [input.stdout, input.stderr].filter(Boolean).join("\n");

  return {
    runId: input.runId,
    planId: input.planId,
    status,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    output,
    stdout: input.stdout,
    stderr: input.stderr,
    diagnostics: input.problems,
  };
}

export function targetRequiresModule(target: BuildTarget) {
  return target !== "app";
}
