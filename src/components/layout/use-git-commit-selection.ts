import { useEffect, useMemo, useState } from "react";
import type { GitChangeEntry, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type Options = {
  rootPath: string | null;
  snapshot: GitRepositorySnapshot | null;
  workspaceApi: WorkspaceApi;
};

export function useGitCommitSelection({ rootPath, snapshot, workspaceApi }: Options) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOverrides({});
    setError(null);
  }, [rootPath]);

  useEffect(() => {
    if (!snapshot) return;
    const paths = new Set(snapshot.changes.map((entry) => entry.relativePath));
    setOverrides((current) => Object.fromEntries(Object.entries(current).filter(([path]) => paths.has(path))));
  }, [snapshot?.snapshotId]);

  const includedPaths = useMemo(() => new Set(
    (snapshot?.changes ?? []).filter((entry) => isIncluded(entry, overrides)).map((entry) => entry.relativePath),
  ), [overrides, snapshot]);

  function toggle(entry: GitChangeEntry) {
    if (entry.conflicted) return;
    setOverrides((current) => ({ ...current, [entry.relativePath]: !isIncluded(entry, current) }));
  }

  function setGroup(entries: GitChangeEntry[], included: boolean) {
    setOverrides((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry) => !entry.conflicted).map((entry) => [entry.relativePath, included])) }));
  }

  async function prepare() {
    if (!rootPath || !snapshot) throw new Error("Open a Git repository before committing.");
    if (snapshot.hasMore) throw new Error("Load the complete change list before committing.");
    const selected = snapshot.changes.filter((entry) => includedPaths.has(entry.relativePath) && !entry.conflicted);
    if (!selected.length) throw new Error("Select at least one change to commit.");
    const stage = selected.filter((entry) => entry.unstaged).map((entry) => entry.relativePath);
    const unstage = snapshot.changes.filter((entry) => entry.staged && !includedPaths.has(entry.relativePath)).map((entry) => entry.relativePath);
    setPreparing(true);
    setError(null);
    try {
      if (unstage.length) await workspaceApi.unstageGitPaths?.({ rootPath, paths: unstage });
      if (stage.length) await workspaceApi.stageGitPaths?.({ rootPath, paths: stage });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      throw reason;
    } finally {
      setPreparing(false);
    }
  }

  return {
    includedPaths,
    includedCount: includedPaths.size,
    preparing,
    error,
    toggle,
    setGroup,
    prepare,
    clearError: () => setError(null),
  };
}

function isIncluded(entry: GitChangeEntry, overrides: Record<string, boolean>) {
  if (entry.conflicted) return false;
  return overrides[entry.relativePath] ?? entry.kind !== "untracked";
}

export type GitCommitSelectionController = ReturnType<typeof useGitCommitSelection>;
