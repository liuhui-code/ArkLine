import type {
  BuildPreflightIssue,
  BuildPreflightResult,
  BuildTarget,
  HarmonyBuildProject,
} from "@/features/build/build-model";
import type { AppSettings } from "@/features/settings/settings-store";

type PreflightInput = {
  project: HarmonyBuildProject | null;
  settings?: AppSettings["sdk"] | null;
  target: BuildTarget;
  moduleName: string | null;
};

function issue(issue: BuildPreflightIssue): BuildPreflightIssue {
  return issue;
}

export function preflightHarmonyBuild(input: PreflightInput): BuildPreflightResult {
  const issues: BuildPreflightIssue[] = [];

  if (!input.project) {
    issues.push(issue({
      severity: "error",
      code: "no-workspace",
      message: "Open a project before building.",
      hint: "Open a HarmonyOS project root, then run Build again.",
    }));
    return { canBuild: false, issues };
  }

  if (!input.project.isHarmonyProject) {
    issues.push(issue({
      severity: "error",
      code: "not-harmony-project",
      message: "This workspace does not look like a HarmonyOS project.",
      hint: "Open the directory that contains build-profile.json5, hvigorfile.ts, and modules.",
    }));
  }

  if (!input.project.hasHvigorWrapper) {
    issues.push(issue({
      severity: "error",
      code: "missing-hvigor-wrapper",
      message: "Hvigor wrapper is missing. Add hvigorw or hvigorw.bat to the project root.",
      hint: "DevEco projects normally include the wrapper in the root so builds use the project-pinned Hvigor version.",
    }));
  }

  if (!input.project.hasHvigorFile) {
    issues.push(issue({
      severity: "error",
      code: "missing-hvigor-file",
      message: "hvigorfile.ts is missing.",
      hint: "Open the real project root or restore the Hvigor entry file.",
    }));
  }

  if (!input.project.hasBuildProfile) {
    issues.push(issue({
      severity: "error",
      code: "missing-build-profile",
      message: "build-profile.json5 is missing.",
      hint: "The build profile defines products, modules, and signing inputs.",
    }));
  }

  if (input.target !== "app" && (!input.moduleName || !input.project.modules.includes(input.moduleName))) {
    issues.push(issue({
      severity: "error",
      code: "missing-module",
      message: "No buildable module is selected.",
      hint: "Select an existing module such as entry, or open a file under module/src/main.",
    }));
  }

  if (!input.project.hasOhPackage) {
    issues.push(issue({
      severity: "warning",
      code: "missing-oh-package",
      message: "oh-package.json5 is missing.",
      hint: "Dependency restore and module metadata may be incomplete.",
    }));
  }

  const settings = input.settings;
  if (settings && !settings.autoDetect && !settings.harmonySdkPath.trim()) {
    issues.push(issue({
      severity: "error",
      code: "missing-sdk-path",
      message: "HarmonyOS SDK path is not configured.",
      hint: "Set the SDK directory in Settings before building.",
    }));
  }

  if (settings && !settings.autoDetect && !settings.nodePath.trim()) {
    issues.push(issue({
      severity: "error",
      code: "missing-node-path",
      message: "Node path is not configured.",
      hint: "Set the Node installation directory in Settings before building.",
    }));
  }

  return {
    canBuild: issues.every((item) => item.severity !== "error"),
    issues,
  };
}
