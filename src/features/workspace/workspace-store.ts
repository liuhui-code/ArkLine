export const DEFAULT_WORKSPACE_EXCLUDES = [
  ".git",
  ".hvigor",
  ".idea",
  ".arkline",
  ".ohpm",
  "build",
  "coverage",
  "dist",
  "oh_modules",
  "out",
  "node_modules"
] as const;

export type WorkspaceOpenInput = {
  rootPath: string;
  files: string[];
};

export type WorkspaceState = {
  rootPath: string | null;
  visibleFiles: string[];
  recentProjects: string[];
};

function dedupeMostRecent(items: string[], value: string) {
  return [value, ...items.filter((item) => item !== value)];
}

function isWindowsStylePath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\");
}

export function normalizePath(path: string) {
  if (isWindowsStylePath(path)) {
    return path.replace(/\//g, "\\").replace(/\\+/g, "\\");
  }

  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function splitPathSegments(path: string) {
  return normalizePath(path).replace(/\\/g, "/").split("/").filter(Boolean);
}

export function getPathBasename(path: string) {
  const segments = splitPathSegments(path);
  return segments.at(-1) ?? normalizePath(path);
}

function shouldExclude(path: string) {
  const parts = splitPathSegments(path);
  return DEFAULT_WORKSPACE_EXCLUDES.some((segment) => parts.includes(segment));
}

export function createWorkspaceStore() {
  const state: WorkspaceState = {
    rootPath: null,
    visibleFiles: [],
    recentProjects: []
  };

  return {
    state,
    openWorkspace(input: WorkspaceOpenInput) {
      const rootPath = normalizePath(input.rootPath);
      const visibleFiles = input.files
        .map(normalizePath)
        .filter((path) => !shouldExclude(path))
        .sort((left, right) => left.localeCompare(right));

      state.rootPath = rootPath;
      state.visibleFiles = visibleFiles;
      state.recentProjects = dedupeMostRecent(state.recentProjects, rootPath);
    }
  };
}
