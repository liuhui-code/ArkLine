import type { FileTreeNode } from "@/features/workspace/file-tree-store";
import type { WorkspaceDirectoryEntry } from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath, splitPathSegments } from "@/features/workspace/workspace-store";

export type ProjectTreeEntry = {
  key: string;
  depth: number;
  kind: "directory" | "file" | "loading";
  label: string;
  path: string;
  expanded?: boolean;
};

export type ProjectTreeNode = {
  label: string;
  path: string;
  kind: "directory" | "file";
  excluded?: boolean;
  lazy?: boolean;
  loading?: boolean;
  children: Map<string, ProjectTreeNode>;
};

export type BuildProjectTreeOptions = {
  lazyRoot?: { name: string; path: string };
  lazyChildren?: Record<string, WorkspaceDirectoryEntry[]>;
  lazyLoadingPaths?: Set<string>;
};

export function buildProjectTree(tree: FileTreeNode[], options: BuildProjectTreeOptions = {}) {
  if (options.lazyRoot) {
    return buildLazyTree(options.lazyRoot, options.lazyChildren ?? {}, options.lazyLoadingPaths ?? new Set());
  }
  return buildFlatTree(tree);
}

export function buildProjectEntries(root: ProjectTreeNode, expandedDirectories: Set<string>) {
  const entries: ProjectTreeEntry[] = [];
  function walk(node: ProjectTreeNode, depth: number) {
    const expanded = node.kind === "directory" ? expandedDirectories.has(node.path) : undefined;
    entries.push({ key: `${node.kind}:${node.path}`, depth, kind: node.kind, label: node.label, path: node.path, expanded });
    if (node.kind === "file" || !expanded) return;
    if (node.loading) {
      entries.push({ key: `loading:${node.path}`, depth: depth + 1, kind: "loading", label: "Loading...", path: `${node.path}::loading` });
    }
    [...node.children.values()]
      .sort((left, right) => left.kind !== right.kind ? (left.kind === "directory" ? -1 : 1) : left.label.localeCompare(right.label))
      .forEach((child) => walk(child, depth + 1));
  }
  walk(root, 0);
  return entries;
}

export function collectDirectoryPaths(root: ProjectTreeNode) {
  const paths: string[] = [];
  function visit(node: ProjectTreeNode) {
    if (node.kind !== "directory") return;
    paths.push(node.path);
    node.children.forEach((child) => visit(child));
  }
  visit(root);
  return paths;
}

export function collectAncestorDirectories(root: ProjectTreeNode, targetPath: string) {
  const ancestors: string[] = [];
  function visit(node: ProjectTreeNode, parents: string[]) {
    if (normalizePath(node.path) === normalizePath(targetPath)) {
      ancestors.push(...parents);
      return true;
    }
    for (const child of node.children.values()) {
      if (visit(child, node.kind === "directory" ? [...parents, node.path] : parents)) return true;
    }
    return false;
  }
  visit(root, []);
  return ancestors;
}

function buildFlatTree(tree: FileTreeNode[]) {
  const paths = tree.map((node) => node.path);
  const splitPaths = paths.map(splitPathSegments);
  let rootSegments = commonRoot(paths);
  if (splitPaths.length > 0 && splitPaths.every((parts) => parts.length === rootSegments.length)) {
    rootSegments = rootSegments.slice(0, -1);
  }
  const rootPath = normalizePath(tree[0]?.path ?? "");
  const rootLabel = rootSegments.at(-1) ?? getPathBasename(rootPath) ?? "Workspace";
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const hasUnixRoot = rootPath.startsWith("/");
  const normalizedRootPath = `${hasUnixRoot ? "/" : ""}${rootSegments.join(separator)}`;
  const root: ProjectTreeNode = { label: rootLabel, path: normalizedRootPath, kind: "directory", children: new Map() };

  for (const node of tree) {
    const segments = splitPathSegments(normalizePath(node.path)).slice(rootSegments.length);
    let current = root;
    let currentPath = normalizedRootPath;
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}${separator}${segment}` : hasUnixRoot ? `/${segment}` : segment;
      const existing = current.children.get(segment);
      if (existing) {
        current = existing;
        return;
      }
      const next: ProjectTreeNode = {
        label: segment,
        path: currentPath,
        kind: index === segments.length - 1 ? "file" : "directory",
        children: new Map(),
      };
      current.children.set(segment, next);
      current = next;
    });
  }
  return root;
}

function buildLazyTree(
  rootInfo: { name: string; path: string },
  childrenByDirectory: Record<string, WorkspaceDirectoryEntry[]>,
  loadingPaths: Set<string>,
) {
  const rootPath = normalizePath(rootInfo.path);
  const root: ProjectTreeNode = {
    label: rootInfo.name,
    path: rootPath,
    kind: "directory",
    children: new Map(),
    loading: loadingPaths.has(rootPath),
  };
  const visited = new Set<string>();
  function hydrateDirectory(node: ProjectTreeNode) {
    const normalizedPath = normalizePath(node.path);
    if (visited.has(normalizedPath)) return;
    visited.add(normalizedPath);
    for (const entry of childrenByDirectory[normalizedPath] ?? []) {
      const childPath = normalizePath(entry.path);
      const child: ProjectTreeNode = {
        label: entry.name,
        path: childPath,
        kind: entry.kind,
        excluded: entry.excluded,
        lazy: entry.kind === "directory" && entry.hasChildren && !entry.excluded,
        loading: loadingPaths.has(childPath),
        children: new Map(),
      };
      node.children.set(childPath, child);
      if (entry.kind === "directory" && childrenByDirectory[childPath]) hydrateDirectory(child);
    }
  }
  hydrateDirectory(root);
  return root;
}

function commonRoot(paths: string[]) {
  if (paths.length === 0) return [];
  const splitPaths = paths.map(splitPathSegments);
  const prefix: string[] = [];
  splitPaths[0]?.forEach((segment, index) => {
    if (splitPaths.every((parts) => parts[index] === segment)) prefix.push(segment);
  });
  return prefix;
}
