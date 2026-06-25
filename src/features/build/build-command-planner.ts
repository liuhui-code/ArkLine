import type { BuildIntent, BuildPlan, BuildTarget, HarmonyBuildRequest } from "@/features/build/build-model";
import { createBuildIntent } from "@/features/build/build-run-model";

function quoteValue(value: string) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function taskForTarget(target: BuildTarget) {
  switch (target) {
    case "app":
      return "assembleApp";
    case "har":
      return "assembleHar";
    case "hsp":
      return "assembleHsp";
    case "hap":
    default:
      return "assembleHap";
  }
}

function labelForTarget(target: BuildTarget) {
  return target.toUpperCase();
}

function commandForIntent(intent: BuildIntent) {
  const daemonArg = intent.fastMode ? "" : " --no-daemon";
  const task = taskForTarget(intent.target);
  const moduleArg = intent.scope === "module" && intent.moduleName
    ? ` -p module=${quoteValue(`${intent.moduleName}@${intent.product}`)}`
    : "";

  return [
    "./hvigorw",
    task,
    `--mode ${intent.scope}`,
    moduleArg.trim(),
    `-p product=${quoteValue(intent.product)}`,
    `-p buildMode=${quoteValue(intent.buildMode)}`,
  ].filter(Boolean).join(" ") + daemonArg;
}

export function planHarmonyBuildCommand(request: HarmonyBuildRequest): BuildPlan {
  const intent = createBuildIntent(request);
  const daemonArg = intent.fastMode ? "" : " --no-daemon";
  const buildCommand = commandForIntent(intent);
  const steps = intent.clean
    ? [
      { label: "Clean", command: `./hvigorw clean${daemonArg}` },
      { label: "Build", command: buildCommand },
    ]
    : [{ label: "Build", command: buildCommand }];

  return {
    label: `Build ${labelForTarget(intent.target)} ${intent.moduleName ?? "project"} ${intent.buildMode}`,
    command: steps.map((step) => step.command).join(" && "),
    cwd: intent.projectRoot,
    target: intent.target,
    intent,
    steps,
  };
}
