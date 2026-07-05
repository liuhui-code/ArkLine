import type { BuildConfiguration } from "@/features/build/build-model";
import type {
  WorkspaceDirectoryEntry,
  WorkspaceSnapshot,
} from "@/features/workspace/workspace-api-contract";
import { invoke, hasTauriRuntime } from "@/features/workspace/workspace-api-runtime";
import {
  DEFAULT_WORKSPACE_EXCLUDES,
  getPathBasename,
  normalizePath,
  splitPathSegments,
} from "@/features/workspace/workspace-store";

export const demoWorkspace: WorkspaceSnapshot = {
  rootName: "DemoWorkspace",
  rootPath: "C:/samples/DemoWorkspace",
  files: [
    "C:/samples/DemoWorkspace/src/main.ets",
    "C:/samples/DemoWorkspace/AppScope/app.json5",
    "C:/samples/DemoWorkspace/node_modules/react/index.js",
  ],
  scanSummary: {
    scannedFiles: 3,
    skippedEntries: 1,
    truncated: false,
    excludeRules: [...DEFAULT_WORKSPACE_EXCLUDES],
  },
};

export const browserBuildConfigurationStore = new Map<string, BuildConfiguration[]>();

export function isDemoWorkspacePath(path: string) {
  return normalizePath(path).startsWith(normalizePath(demoWorkspace.rootPath));
}

export async function loadWorkspaceSnapshot(rootPath: string) {
  if (hasTauriRuntime()) {
    return invoke<WorkspaceSnapshot>("open_workspace", { rootPath });
  }

  const normalized = normalizePath(rootPath);
  if (normalized === normalizePath(demoWorkspace.rootPath)) {
    return demoWorkspace;
  }

  const rootName = getPathBasename(normalized) || "Workspace";
  return {
    rootName,
    rootPath: normalized,
    files: [
      joinPath(normalized, "AppScope", "app.json5"),
      joinPath(normalized, "src", "main.ets"),
      joinPath(normalized, "src", "pages", "Index.ets"),
    ],
  };
}

export function listDirectoryFromSnapshot(
  snapshot: WorkspaceSnapshot,
  directoryPath: string,
): WorkspaceDirectoryEntry[] {
  const normalizedDirectory = normalizePath(directoryPath);
  const directorySegments = splitPathSegments(normalizedDirectory);
  const entries = new Map<string, WorkspaceDirectoryEntry>();

  for (const file of snapshot.files) {
    const normalizedFile = normalizePath(file);
    const fileSegments = splitPathSegments(normalizedFile);
    const isDescendant = directorySegments.every((segment, index) => fileSegments[index] === segment)
      && fileSegments.length > directorySegments.length;

    if (!isDescendant) continue;

    const childName = fileSegments[directorySegments.length];
    if (!childName) continue;

    const childPath = joinWorkspacePath(normalizedDirectory, childName);
    const remainingSegments = fileSegments.slice(directorySegments.length + 1);
    const isDirectory = remainingSegments.length > 0;
    const excluded = pathHasExcludedSegment(childPath);
    const existing = entries.get(childPath);

    entries.set(childPath, {
      name: childName,
      path: childPath,
      kind: isDirectory ? "directory" : "file",
      excluded,
      hasChildren: Boolean((existing?.hasChildren ?? false) || (isDirectory && !excluded && remainingSegments.length > 0)),
    });
  }

  return [...entries.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

export async function loadMockDocumentContent(path: string) {
  const normalized = normalizePath(path);

  if (normalized.endsWith("main.ets")) {
    return "@Entry\n@Component\nstruct Index {}";
  }

  if (normalized.endsWith("app.json5")) {
    return "{\n  \"app\": {\n    \"bundleName\": \"com.demo.app\"\n  }\n}";
  }

  return "";
}

function joinPath(base: string, ...segments: string[]) {
  const separator = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/g, ""), ...segments].join(separator);
}

function joinWorkspacePath(base: string, child: string) {
  const normalizedBase = normalizePath(base).replace(/[\\/]+$/g, "");
  const separator = normalizedBase.includes("\\") ? "\\" : "/";
  return `${normalizedBase}${separator}${child}`;
}

function pathHasExcludedSegment(path: string) {
  const segments = splitPathSegments(path);
  return DEFAULT_WORKSPACE_EXCLUDES.some((segment) => segments.includes(segment));
}
