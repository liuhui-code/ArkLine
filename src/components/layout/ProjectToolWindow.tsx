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

function buildEntries(tree: FileTreeNode[]) {
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

  const entries: TreeEntry[] = [];

  function walk(node: InternalNode, depth: number) {
    entries.push({
      key: `${node.kind}:${node.path}`,
      depth,
      kind: node.kind,
      label: node.label,
      path: node.path
    });

    if (node.kind === "file") {
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

export function ProjectToolWindow({
  tree,
  activePath,
  onOpen
}: ProjectToolWindowProps) {
  const entries = buildEntries(tree);

  return (
    <div className="project-tree" role="tree" aria-label="Workspace File Tree">
      {entries.map((entry) =>
        entry.kind === "directory" ? (
          <div
            key={entry.key}
            className="project-tree__row project-tree__row--directory"
            style={{ paddingLeft: `${entry.depth * 16 + 8}px` }}
          >
            <span className="project-tree__caret" aria-hidden="true">
              {entry.depth === 0 ? "▾" : "▸"}
            </span>
            <span className="project-tree__icon project-tree__icon--directory" aria-hidden="true" />
            <span className="project-tree__label">{entry.label}</span>
          </div>
        ) : (
          <button
            key={entry.key}
            type="button"
            className={`project-tree__row project-tree__row--file${activePath === entry.path ? " project-tree__row--active" : ""}`}
            style={{ paddingLeft: `${entry.depth * 16 + 8}px` }}
            title={entry.path}
            aria-current={activePath === entry.path ? "true" : undefined}
            onClick={() => onOpen(entry.path)}
          >
            <span className="project-tree__caret" aria-hidden="true" />
            <span className="project-tree__icon project-tree__icon--file" aria-hidden="true" />
            <span className="project-tree__label">{entry.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
