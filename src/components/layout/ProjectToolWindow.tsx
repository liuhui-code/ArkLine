import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ContextMenu, type ContextMenuState } from "@/components/layout/ContextMenu";
import { ProjectTreeRow } from "@/components/layout/ProjectTreeRows";
import {
  buildProjectEntries,
  buildProjectTree,
  collectAncestorDirectories,
  collectDirectoryPaths,
  type ProjectTreeNode,
} from "@/components/layout/project-tree-model";
import { useLatestCallback } from "@/components/layout/use-latest-callback";
import type { FileTreeNode } from "@/features/workspace/file-tree-store";
import type { WorkspaceDirectoryEntry } from "@/features/workspace/workspace-api";
import { normalizePath } from "@/features/workspace/workspace-store";
import { recordRenderPressure } from "@/features/performance/use-ui-latency-monitor";

type ProjectToolWindowProps = {
  tree?: FileTreeNode[];
  lazyRoot?: { name: string; path: string };
  lazyChildren?: Record<string, WorkspaceDirectoryEntry[]>;
  lazyLoadingPaths?: Set<string>;
  activePath: string | null;
  selectedPath?: string | null;
  onOpen: (path: string) => void;
  onSelectPath?: (path: string) => void;
  onLoadDirectory?: (path: string) => void;
  onRequestMutation: (request: ProjectMutationRequest) => void;
};

export type ProjectMutationRequest =
  | { action: "newFile"; parentPath: string }
  | { action: "newDirectory"; parentPath: string };

type ProjectContextTarget = {
  kind: "directory" | "file";
  label: string;
  path: string;
};

function getParentPath(path: string, fallback: string) {
  const separator = path.includes("\\") ? "\\" : "/";
  const lastSeparator = path.lastIndexOf(separator);
  if (lastSeparator <= 0) {
    return fallback;
  }
  return path.slice(0, lastSeparator);
}

function ProjectToolWindowComponent({
  tree,
  lazyRoot,
  lazyChildren,
  lazyLoadingPaths,
  activePath,
  selectedPath,
  onOpen,
  onSelectPath,
  onLoadDirectory,
  onRequestMutation,
}: ProjectToolWindowProps) {
  recordRenderPressure("Project/Tree");
  const root = useMemo(() => {
    return buildProjectTree(tree ?? [], { lazyRoot, lazyChildren, lazyLoadingPaths });
  }, [lazyChildren, lazyLoadingPaths, lazyRoot, tree]);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const normalizedActivePath = activePath ? normalizePath(activePath) : null;
  const normalizedSelectedPath = selectedPath ? normalizePath(selectedPath) : null;
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());
  const [lazyExpandedDirectories, setLazyExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [pendingFocusPath, setPendingFocusPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const expandedDirectories = useMemo(() => {
    if (lazyRoot) {
      return new Set([normalizePath(lazyRoot.path), ...lazyExpandedDirectories]);
    }

    const expanded = new Set<string>();

    function visit(node: ProjectTreeNode) {
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
  }, [collapsedDirectories, lazyExpandedDirectories, lazyRoot, root]);
  const entries = useMemo(() => buildProjectEntries(root, expandedDirectories), [expandedDirectories, root]);

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
    const entry = entries.find((item) => normalizePath(item.path) === normalizePath(path));
    if (entry?.kind === "directory") {
      onLoadDirectory?.(normalizePath(path));
    }

    if (lazyRoot) {
      setLazyExpandedDirectories((current) => {
        const next = new Set(current);
        const normalizedPath = normalizePath(path);
        if (next.has(normalizedPath)) {
          next.delete(normalizedPath);
        } else {
          next.add(normalizedPath);
        }
        return next;
      });
      return;
    }

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
    if (lazyRoot) {
      const directories = collectDirectoryPaths(root).map(normalizePath).filter((path) => path !== normalizePath(root.path));
      setLazyExpandedDirectories(new Set(directories));
      directories.forEach((path) => onLoadDirectory?.(path));
      return;
    }

    setCollapsedDirectories(new Set());
  }

  function collapseAll() {
    if (lazyRoot) {
      setLazyExpandedDirectories(new Set());
      return;
    }

    const collapsed = collectDirectoryPaths(root).filter((path) => path !== root.path);
    setCollapsedDirectories(new Set(collapsed));
  }

  function focusActiveFile() {
    if (!activePath) {
      return;
    }

    const normalizedActivePath = normalizePath(activePath);
    const ancestors = collectAncestorDirectories(root, normalizedActivePath);
    if (lazyRoot) {
      const lazyAncestors = ancestors.map(normalizePath).filter((path) => path !== normalizePath(root.path));
      setLazyExpandedDirectories((current) => new Set([...current, ...lazyAncestors]));
      lazyAncestors.forEach((path) => onLoadDirectory?.(path));
      setPendingFocusPath(normalizedActivePath);
      return;
    }

    setCollapsedDirectories((current) => {
      const next = new Set(current);
      ancestors.forEach((path) => next.delete(path));
      return next;
    });
    setPendingFocusPath(normalizedActivePath);
  }

  function copyPath(path: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(path);
  }

  function openProjectContextMenu(event: ReactMouseEvent<HTMLElement>, target: ProjectContextTarget) {
    event.preventDefault();
    event.stopPropagation();
    const parentPath = target.kind === "directory" ? target.path : getParentPath(target.path, root.path);
    const canToggleDirectory = target.kind === "directory";

    setContextMenu({
      label: `${target.label} actions`,
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: "open", label: "Open", disabled: target.kind !== "file", onSelect: () => onOpen(target.path) },
        { id: "new-file", label: "New File", separatorBefore: true, onSelect: () => onRequestMutation({ action: "newFile", parentPath }) },
        { id: "new-directory", label: "New Directory", onSelect: () => onRequestMutation({ action: "newDirectory", parentPath }) },
        {
          id: "toggle-directory",
          label: canToggleDirectory && expandedDirectories.has(target.path) ? "Collapse" : "Expand",
          disabled: !canToggleDirectory,
          separatorBefore: true,
          onSelect: () => toggleDirectory(target.path),
        },
        { id: "copy-path", label: "Copy Path", separatorBefore: true, onSelect: () => copyPath(target.path) },
      ],
    });
  }

  const activateEntry = useLatestCallback((entry: ReturnType<typeof buildProjectEntries>[number]) => {
    const path = normalizePath(entry.path);
    onSelectPath?.(path);
    if (entry.kind === "directory") {
      toggleDirectory(entry.path);
    } else if (entry.kind === "file") {
      onOpen(entry.path);
    }
  });
  const openEntryContextMenu = useLatestCallback((
    event: ReactMouseEvent<HTMLElement>,
    entry: ReturnType<typeof buildProjectEntries>[number],
  ) => {
    if (entry.kind === "loading") return;
    openProjectContextMenu(event, {
      kind: entry.kind,
      label: entry.label,
      path: entry.path,
    });
  });
  const registerFileRow = useCallback((path: string, node: HTMLButtonElement | null) => {
    const normalizedPath = normalizePath(path);
    if (node) rowRefs.current.set(normalizedPath, node);
    else rowRefs.current.delete(normalizedPath);
  }, []);

  return (
    <div className="project-tree-shell">
      <div className="project-tree-toolbar" role="toolbar" aria-label="Project Tree Actions">
        <button type="button" className="project-tree-toolbar__button" aria-label="New File" onClick={() => onRequestMutation({ action: "newFile", parentPath: root.path })}>F</button>
        <button type="button" className="project-tree-toolbar__button" aria-label="New Directory" onClick={() => onRequestMutation({ action: "newDirectory", parentPath: root.path })}>D</button>
        <button type="button" className="project-tree-toolbar__button" aria-label="Expand All" onClick={expandAll}>+</button>
        <button type="button" className="project-tree-toolbar__button" aria-label="Collapse All" onClick={collapseAll}>-</button>
        <button type="button" className="project-tree-toolbar__button" aria-label="Focus Active File" onClick={focusActiveFile}>*</button>
      </div>
      <div
        className="project-tree"
        role="tree"
        aria-label="Workspace File Tree"
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          openProjectContextMenu(event, { kind: "directory", label: root.label, path: root.path });
        }}
      >
        {entries.map((entry) => (
          <ProjectTreeRow
            key={entry.key}
            entry={entry}
            active={normalizedActivePath === normalizePath(entry.path)}
            selected={normalizedSelectedPath === normalizePath(entry.path)}
            onActivate={activateEntry}
            onContextMenu={openEntryContextMenu}
            registerFileRow={registerFileRow}
          />
        ))}
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}

export const ProjectToolWindow = memo(ProjectToolWindowComponent);
