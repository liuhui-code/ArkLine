import type {
  BuildPreflightIssue,
  BuildPreflightResult,
  BuildEnvironmentResolution,
  BuildTarget,
  HarmonyBuildProject,
} from "@/features/build/build-model";
import type { AppSettings } from "@/features/settings/settings-store";

type PreflightInput = {
  project: HarmonyBuildProject | null;
  settings?: AppSettings["sdk"] | null;
  target: BuildTarget;
  moduleName: string | null;
  product: string;
  environment?: BuildEnvironmentResolution | null;
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

  const externalHvigorReady = input.environment?.checks.some(
    (check) => check.name === "hvigor" && check.available,
  ) ?? false;
  if (!input.project.hasHvigorWrapper && !externalHvigorReady) {
    issues.push(issue({
      severity: "error",
      code: "missing-hvigor-wrapper",
      message: `Hvigor wrapper is missing from ${input.project.rootPath}.`,
      hint: "Restore the platform wrapper in the canonical project root so the build uses the project-pinned Hvigor version.",
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

  if (input.target !== "har") {
    const signing = input.project.productSigning.find((item) => item.product === input.product);
    // The visible-file browser fallback cannot read build-profile.json5. Native
    // inspection always returns one status per product and owns signing checks.
    if (input.project.productSigning.length > 0 && !signing?.signingConfig) {
      issues.push(issue({
        severity: "error",
        code: "missing-signing-config",
        message: `Product ${input.product} has no usable signing configuration.`,
        hint: "Configure app.signingConfigs and reference it from the selected product's signingConfig in build-profile.json5.",
      }));
    } else if (signing && !signing.ready) {
      issues.push(issue({
        severity: "error",
        code: "invalid-signing-material",
        message: `Signing configuration ${signing.signingConfig} is incomplete.`,
        hint: signing.issues.join("; "),
      }));
    }
  }

  const requiredCompileApi = apiMajor(input.project.productSdks?.find(
    (item) => item.product === input.product,
  )?.compileSdkVersion);
  const installedApi = apiMajor(input.environment?.sdkApiVersion);
  if (requiredCompileApi !== null && installedApi !== null && requiredCompileApi > installedApi) {
    issues.push(issue({
      severity: "error",
      code: "incompatible-compile-sdk",
      message: `Product ${input.product} requires compile SDK API ${requiredCompileApi}, but the selected SDK provides API ${installedApi}.`,
      hint: `Install HarmonyOS SDK API ${requiredCompileApi} or newer, or select a compatible product.`,
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

  for (const check of input.environment?.checks ?? []) {
    if (check.available) {
      continue;
    }
    const isNode = check.name === "node";
    const isHvigor = check.name === "hvigor";
    issues.push(issue({
      severity: "error",
      code: isNode ? "build-environment-node" : isHvigor ? "build-environment-hvigor" : "build-environment-sdk",
      message: `${isNode ? "Node" : isHvigor ? "Hvigor wrapper" : "HarmonyOS SDK"} is not available to the build.`,
      hint: check.detail,
    }));
  }

  return {
    canBuild: issues.every((item) => item.severity !== "error"),
    issues,
  };
}

function apiMajor(version: string | null | undefined): number | null {
  const normalized = version?.trim();
  if (!normalized) return null;
  const integerMatch = normalized.match(/^(\d+)$/);
  const unifiedMatch = normalized.match(/^(\d+)\.\d+\.\d+$/);
  const value = Number(integerMatch?.[1] ?? unifiedMatch?.[1]);
  if (!integerMatch && (!unifiedMatch || value < 26)) return null;
  return Number.isSafeInteger(value) ? value : null;
}
