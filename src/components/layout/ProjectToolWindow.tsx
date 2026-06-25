import { useEffect, useMemo, useRef, useState } from "react";
import type { FileTreeNode } from "@/features/workspace/file-tree-store";
import { getPathBasename, normalizePath, splitPathSegments } from "@/features/workspace/workspace-store";

type ProjectToolWindowProps = {
  tree: FileTreeNode[];
  activePath: string | null;
  onOpen: (path: string) => void;
};

type TreeEntry = {
  key: string;
  depth: number;
  kind: "directory" | "file";
  label: string;
  path: string;
  expanded?: boolean;
};

type InternalNode = {
  label: string;
  path: string;
  kind: "directory" | "file";
  children: Map<string, InternalNode>;
};

function commonRoot(paths: string[]) {
  if (paths.length === 0) {
    return [];
  }

  const splitPaths = paths.map(splitPathSegments);
  const prefix: string[] = [];

  splitPaths[0]?.forEach((segment, index) => {
    if (splitPaths.every((parts) => parts[index] === segment)) {
      prefix.push(segment);
    }
  });

  return prefix;
}

function buildTree(tree: FileTreeNode[]) {
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
  const root: InternalNode = {
    label: rootLabel,
    path: normalizedRootPath,
    kind: "directory",
    children: new Map<string, InternalNode>()
  };

  for (const node of tree) {
    const normalizedPath = normalizePath(node.path);
    const segments = splitPathSegments(normalizedPath).slice(rootSegments.length);
    let current = root;
    let currentPath = normalizedRootPath;

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}${separator}${segment}` : hasUnixRoot ? `/${segment}` : segment;
      const isFile = index === segments.length - 1;
      const existing = current.children.get(segment);

      if (existing) {
        current = existing;
        return;
      }

      const next: InternalNode = {
        label: segment,
        path: currentPath,
        kind: isFile ? "file" : "directory",
        children: new Map<string, InternalNode>()
      };

      current.children.set(segment, next);
      current = next;
    });
  }

  return root;
}

function buildEntries(root: InternalNode, expandedDirectories: Set<string>) {
  const entries: TreeEntry[] = [];

  function walk(node: InternalNode, depth: number) {
    const expanded = node.kind === "directory" ? expandedDirectories.has(node.path) : undefined;
    entries.push({
      key: `${node.kind}:${node.path}`,
      depth,
      kind: node.kind,
      label: node.label,
      path: node.path,
      expanded,
    });

    if (node.kind === "file" || !expanded) {
      return;
    }

    const children = [...node.children.values()].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.label.localeCompare(right.label);
    });

    children.forEach((child) => walk(child, depth + 1));
  }

  walk(root, 0);
  return entries;
}

function collectDirectoryPaths(root: InternalNode) {
  const paths: string[] = [];

  function visit(node: InternalNode) {
    if (node.kind !== "directory") {
      return;
    }

    paths.push(node.path);
    node.children.forEach((child) => visit(child));
  }

  visit(root);
  return paths;
}

function collectAncestorDirectories(root: InternalNode, targetPath: string) {
  const ancestors: string[] = [];

  function visit(node: InternalNode, parents: string[]) {
    if (normalizePath(node.path) === normalizePath(targetPath)) {
      ancestors.push(...parents);
      return true;
    }

    for (const child of node.children.values()) {
      if (visit(child, node.kind === "directory" ? [...parents, node.path] : parents)) {
        return true;
      }
    }

    return false;
  }

  visit(root, []);
  return ancestors;
}

export function ProjectToolWindow({
  tree,
  activePath,
  onOpen
}: ProjectToolWindowProps) {
  const root = useMemo(() => buildTree(tree), [tree]);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const normalizedActivePath = activePath ? normalizePath(activePath) : null;
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const [pendingFocusPath, setPendingFocusPath] = useState<string | null>(null);
  const expandedDirectories = useMemo(() => {
    const expanded = new Set<string>();

    function visit(node: InternalNode) {
      if (node.kind !== "directory") {
        return;
      }

      if (!collapsedDirectories.has(node.path)) {
        expanded.add(node.path);
        node.children.forEach((child) => visit(child));
      }
    }

    visit(root);
    return expanded;
  }, [collapsedDirectories, root]);
  const entries = useMemo(() => buildEntries(root, expandedDirectories), [expandedDirectories, root]);

  useEffect(() => {
    if (!pendingFocusPath) {
      return;
    }

    const row = rowRefs.current.get(pendingFocusPath);
    if (!row) {
      return;
    }

    if (typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
    row.focus();
    setPendingFocusPath(null);
  }, [entries, pendingFocusPath]);

  function toggleDirectory(path: string) {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function expandAll() {
    setCollapsedDirectories(new Set());
  }

  function collapseAll() {
    const collapsed = collectDirectoryPaths(root).filter((path) => path !== root.path);
    setCollapsedDirectories(new Set(collapsed));
  }

  function focusActiveFile() {
    if (!activePath) {
      return;
    }

    const normalizedActivePath = normalizePath(activePath);
    const ancestors = collectAncestorDirectories(root, normalizedActivePath);
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      ancestors.forEach((path) => next.delete(path));
      return next;
    });
    setPendingFocusPath(normalizedActivePath);
  }

  return (
    <div className="project-tree-shell">
      <div className="project-tree-toolbar" role="toolbar" aria-label="Project Tree Actions">
        <button type="button" className="project-tree-toolbar__button" aria-label="Expand All" onClick={expandAll}>+</button>
        <button type="button" className="project-tree-toolbar__button" aria-label="Collapse All" onClick={collapseAll}>-</button>
        <button type="button" className="project-tree-toolbar__button" aria-label="Focus Active File" onClick={focusActiveFile}>*</button>
      </div>
      <div className="project-tree" role="tree" aria-label="Workspace File Tree">
        {entries.map((entry) =>
          entry.kind === "directory" ? (
            <button
              key={entry.key}
              type="button"
              className="project-tree__row project-tree__row--directory"
              style={{ paddingLeft: `${entry.depth * 16 + 8}px` }}
              aria-expanded={entry.expanded ? "true" : "false"}
              onClick={() => toggleDirectory(entry.path)}
            >
              <span className="project-tree__caret" aria-hidden="true">
                {entry.expanded ? "▾" : "▸"}
              </span>
              <span className="project-tree__icon project-tree__icon--directory" aria-hidden="true" />
              <span className="project-tree__label">{entry.label}</span>
            </button>
          ) : (
            <button
              key={entry.key}
              ref={(node) => {
                if (node) {
                  rowRefs.current.set(normalizePath(entry.path), node);
                } else {
                  rowRefs.current.delete(normalizePath(entry.path));
                }
              }}
              type="button"
              className={`project-tree__row project-tree__row--file${normalizedActivePath === normalizePath(entry.path) ? " project-tree__row--active" : ""}`}
              style={{ paddingLeft: `${entry.depth * 16 + 8}px` }}
              title={entry.path}
              aria-current={normalizedActivePath === normalizePath(entry.path) ? "true" : undefined}
              onClick={() => onOpen(entry.path)}
            >
              <span className="project-tree__caret" aria-hidden="true" />
              <span className="project-tree__icon project-tree__icon--file" aria-hidden="true" />
              <span className="project-tree__label">{entry.label}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
