import type { ProblemItem } from "@/features/problems/problems-store";

export type BuildTarget = "hap" | "app" | "har" | "hsp";
export type BuildStatus = "idle" | "planning" | "running" | "success" | "failed" | "stopped";
export type BuildActionKind = "build";
export type BuildScope = "project" | "module";

export type BuildIntent = {
  kind: BuildActionKind;
  projectRoot: string;
  target: BuildTarget;
  scope: BuildScope;
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  clean: boolean;
  fastMode: boolean;
};

export type HarmonyBuildRequest = {
  rootPath: string;
  target: BuildTarget;
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  clean: boolean;
  fastMode: boolean;
};

export type BuildPlanStep = {
  label: string;
  command: string;
};

export type BuildPlan = {
  id?: string;
  runId?: string;
  label: string;
  cwd: string;
  target: BuildTarget;
  intent: BuildIntent;
  steps: BuildPlanStep[];
  command: string;
};

export type HarmonyBuildPlan = BuildPlan;

export type BuildResultStatus = "success" | "failed" | "stopped";

export type BuildResult = {
  runId: string;
  planId?: string;
  status: BuildResultStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
  stdout: string;
  stderr: string;
  diagnostics: ProblemItem[];
};

export type HarmonyBuildProject = {
  rootPath: string;
  isHarmonyProject: boolean;
  hasHvigorWrapper: boolean;
  hasHvigorFile: boolean;
  hasBuildProfile: boolean;
  hasOhPackage: boolean;
  modules: string[];
  defaultModule: string | null;
};

export type BuildRunFinish = {
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  problems: ProblemItem[];
  stopped?: boolean;
};

export type BuildState = {
  status: BuildStatus;
  currentRun: HarmonyBuildPlan | null;
  lastTarget: BuildTarget;
  moduleName: string;
  products: string[];
  product: string;
  buildMode: "debug" | "release";
  fastMode: boolean;
  output: string;
  problems: ProblemItem[];
  lastResult: BuildResult | null;
  lastExitCode: number | null;
  lastDurationMs: number | null;
  message: string;
};
