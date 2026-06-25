import type { BuildTarget, HarmonyBuildPlan, HarmonyBuildRequest } from "@/features/build/build-model";

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

function modeForTarget(target: BuildTarget) {
  return target === "app" ? "project" : "module";
}

function labelForTarget(target: BuildTarget) {
  return target.toUpperCase();
}

export function planHarmonyBuildCommand(request: HarmonyBuildRequest): HarmonyBuildPlan {
  const daemonArg = request.fastMode ? "" : " --no-daemon";
  const task = taskForTarget(request.target);
  const mode = modeForTarget(request.target);
  const moduleArg = mode === "module" && request.moduleName
    ? ` -p module=${quoteValue(`${request.moduleName}@${request.product}`)}`
    : "";
  const buildCommand = [
    "./hvigorw",
    task,
    `--mode ${mode}`,
    moduleArg.trim(),
    `-p product=${quoteValue(request.product)}`,
    `-p buildMode=${quoteValue(request.buildMode)}`,
  ].filter(Boolean).join(" ") + daemonArg;
  const command = request.clean
    ? `./hvigorw clean${daemonArg} && ${buildCommand}`
    : buildCommand;

  return {
    label: `Build ${labelForTarget(request.target)} ${request.moduleName ?? "project"} ${request.buildMode}`,
    command,
    cwd: request.rootPath,
    target: request.target,
  };
}
