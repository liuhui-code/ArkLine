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

function argsForIntent(intent: BuildIntent) {
  const task = taskForTarget(intent.target);
  const moduleArgs = intent.scope === "module" && intent.moduleName
    ? ["-p", `module=${intent.moduleName}@${intent.product}`]
    : [];

  return [
    task,
    "--mode",
    intent.scope,
    ...moduleArgs,
    "-p",
    `product=${intent.product}`,
    "-p",
    `buildMode=${intent.buildMode}`,
    ...(intent.fastMode ? [] : ["--no-daemon"]),
  ];
}

function renderCommand(program: string, args: string[]) {
  return [program, ...args].map(quoteValue).join(" ");
}

export function planHarmonyBuildCommand(request: HarmonyBuildRequest): BuildPlan {
  const intent = createBuildIntent(request);
  const wrapperCommand = request.wrapperCommand?.trim() || "./hvigorw";
  const buildArgs = argsForIntent(intent);
  const buildCommand = renderCommand(wrapperCommand, buildArgs);
  const cleanArgs = ["clean", ...(intent.fastMode ? [] : ["--no-daemon"])];
  const steps = intent.clean
    ? [
      { label: "Clean", command: renderCommand(wrapperCommand, cleanArgs), program: wrapperCommand, args: cleanArgs },
      { label: "Build", command: buildCommand, program: wrapperCommand, args: buildArgs },
    ]
    : [{ label: "Build", command: buildCommand, program: wrapperCommand, args: buildArgs }];

  return {
    label: `Build ${labelForTarget(intent.target)} ${intent.moduleName ?? "project"} ${intent.buildMode}`,
    command: steps.map((step) => step.command).join(" && "),
    cwd: intent.projectRoot,
    target: intent.target,
    intent,
    steps,
  };
}
