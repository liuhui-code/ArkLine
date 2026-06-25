import type { HarmonyBuildProject } from "@/features/build/build-model";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

function relativePath(rootPath: string, path: string) {
  const root = normalizePath(rootPath).replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = normalizePath(path).replace(/\\/g, "/");

  if (!normalized.startsWith(`${root}/`)) {
    return normalized;
  }

  return normalized.slice(root.length + 1);
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function detectModules(rootPath: string, files: string[]) {
  return uniqueSorted(files
    .map((file) => relativePath(rootPath, file))
    .map((file) => file.split("/"))
    .filter((segments) => segments.length > 3 && segments[1] === "src" && segments[2] === "main")
    .map((segments) => segments[0])
    .filter(Boolean));
}

export function detectHarmonyBuildProject(rootPath: string, files: string[]): HarmonyBuildProject {
  const relativeFiles = files.map((file) => relativePath(rootPath, file));
  const modules = detectModules(rootPath, files);
  const hasHvigorWrapper = relativeFiles.some((file) => getPathBasename(file) === "hvigorw" || getPathBasename(file) === "hvigorw.bat");
  const hasHvigorFile = relativeFiles.includes("hvigorfile.ts");
  const hasBuildProfile = relativeFiles.includes("build-profile.json5");
  const hasOhPackage = relativeFiles.includes("oh-package.json5");
  const isHarmonyProject = hasHvigorFile || hasBuildProfile || hasOhPackage || modules.length > 0;
  const defaultModule = modules.includes("entry") ? "entry" : modules[0] ?? null;

  return {
    rootPath: normalizePath(rootPath),
    isHarmonyProject,
    hasHvigorWrapper,
    hasHvigorFile,
    hasBuildProfile,
    hasOhPackage,
    modules,
    defaultModule,
  };
}

export function inferBuildModuleForPath(project: HarmonyBuildProject | null, path: string | null): string | null {
  if (!project) {
    return null;
  }

  if (path) {
    const relative = relativePath(project.rootPath, path);
    const segments = relative.split("/");
    if (segments.length > 3 && segments[1] === "src" && segments[2] === "main" && project.modules.includes(segments[0])) {
      return segments[0];
    }
  }

  return project.defaultModule;
}
