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

  const inclusionStates = useMemo(() => new Map(
    (snapshot?.changes ?? []).map((entry) => [entry.relativePath, inclusionState(entry, overrides)]),
  ), [overrides, snapshot]);
  const includedPaths = useMemo(() => new Set(
    [...inclusionStates].filter(([, state]) => state !== "excluded").map(([path]) => path),
  ), [inclusionStates]);
  const partiallyIncludedPaths = useMemo(() => new Set(
    [...inclusionStates].filter(([, state]) => state === "partial").map(([path]) => path),
  ), [inclusionStates]);

  function toggle(entry: GitChangeEntry) {
    if (entry.conflicted) return;
    setOverrides((current) => ({
      ...current,
      [entry.relativePath]: inclusionState(entry, current) !== "included",
    }));
  }

  function setGroup(entries: GitChangeEntry[], included: boolean) {
    setOverrides((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry) => !entry.conflicted).map((entry) => [entry.relativePath, included])) }));
  }

  async function prepare() {
    if (!rootPath || !snapshot) throw new Error("Open a Git repository before committing.");
    if (snapshot.hasMore) throw new Error("Load the complete change list before committing.");
    const selected = snapshot.changes.filter((entry) => inclusionStates.get(entry.relativePath) !== "excluded" && !entry.conflicted);
    if (!selected.length) throw new Error("Select at least one change to commit.");
    const stage = selected
      .filter((entry) => entry.unstaged && inclusionStates.get(entry.relativePath) === "included")
      .map((entry) => entry.relativePath);
    const unstage = snapshot.changes
      .filter((entry) => entry.staged && inclusionStates.get(entry.relativePath) === "excluded")
      .map((entry) => entry.relativePath);
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
    partiallyIncludedPaths,
    includedCount: includedPaths.size,
    preparing,
    error,
    toggle,
    setGroup,
    prepare,
    clearError: () => setError(null),
  };
}

type GitCommitInclusionState = "excluded" | "partial" | "included";

function inclusionState(entry: GitChangeEntry, overrides: Record<string, boolean>): GitCommitInclusionState {
  if (entry.conflicted) return "excluded";
  const override = overrides[entry.relativePath];
  if (override !== undefined) return override ? "included" : "excluded";
  if (entry.staged && entry.unstaged) return "partial";
  return entry.kind === "untracked" ? "excluded" : "included";
}

export type GitCommitSelectionController = ReturnType<typeof useGitCommitSelection>;
