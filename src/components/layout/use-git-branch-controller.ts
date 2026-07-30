import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitBranch, GitBranchSnapshot } from "@/features/git/git-branch-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

export type GitBranchPickerItem = GitBranch & {
  group: "Recent" | "Local" | "Remote";
};

type UseGitBranchControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
  hasDirtyDocuments: () => boolean;
  onRefreshWorkspace: (rootPath: string, branchName: string | null) => Promise<void>;
  onStatusChange: (message: string) => void;
};

export function useGitBranchController({
  workspaceApi,
  workspaceRootPath,
  hasDirtyDocuments,
  onRefreshWorkspace,
  onStatusChange,
}: UseGitBranchControllerOptions) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<GitBranchSnapshot | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<GitBranchPickerItem | null>(null);

  const items = useMemo(() => buildBranchItems(snapshot, query), [query, snapshot]);
  const currentBranch = snapshot?.currentBranch ?? (snapshot?.detached ? "Detached HEAD" : "No Git branch");

  useEffect(() => {
    setVisible(false);
    setSnapshot(null);
    setQuery("");
    setSelectedIndex(0);
    setError(null);
    setPendingCheckout(null);
  }, [workspaceRootPath]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(items.length - 1, 0)));
  }, [items.length]);

  const loadBranches = useCallback(async () => {
    if (!workspaceRootPath || !workspaceApi.listGitBranches) {
      setError("Git branch switching is unavailable without an open Git workspace.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await workspaceApi.listGitBranches(workspaceRootPath));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [workspaceApi, workspaceRootPath]);

  useEffect(() => {
    if (workspaceRootPath) void loadBranches();
  }, [loadBranches, workspaceRootPath]);

  const open = useCallback(() => {
    setVisible(true);
    setQuery("");
    setSelectedIndex(0);
    void loadBranches();
  }, [loadBranches]);

  const close = useCallback(() => {
    if (!switching) {
      setVisible(false);
      setError(null);
      setPendingCheckout(null);
    }
  }, [switching]);

  const moveSelection = useCallback((delta: number) => {
    setSelectedIndex((index) => {
      if (items.length === 0) return 0;
      return (index + delta + items.length) % items.length;
    });
  }, [items.length]);

  const performCheckout = useCallback(async (item: GitBranchPickerItem, strategy: "preserve" | "stash") => {
    if (!workspaceRootPath || !workspaceApi.checkoutGitBranch || item.current || switching) return;
    setSwitching(true);
    setError(null);
    try {
      const result = await workspaceApi.checkoutGitBranch({ rootPath: workspaceRootPath, name: item.name, kind: item.kind, strategy });
      setSnapshot(result.snapshot);
      setPendingCheckout(null);
      setVisible(false);
      onStatusChange(result.message);
      await onRefreshWorkspace(workspaceRootPath, result.snapshot.currentBranch);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSwitching(false);
    }
  }, [onRefreshWorkspace, onStatusChange, switching, workspaceApi, workspaceRootPath]);

  const checkout = useCallback((item: GitBranchPickerItem) => {
    if (item.current || switching) return;
    if (hasDirtyDocuments()) {
      setError("Save or discard open editor changes before switching branches.");
      return;
    }
    if (snapshot?.workingTree.conflictedFiles) {
      setError("Resolve working tree conflicts before switching branches.");
      return;
    }
    if (snapshot?.workingTree.dirty) {
      setPendingCheckout(item);
      setError(null);
      return;
    }
    void performCheckout(item, "preserve");
  }, [hasDirtyDocuments, performCheckout, snapshot?.workingTree, switching]);

  const cancelPendingCheckout = useCallback(() => setPendingCheckout(null), []);
  const preserveAndCheckout = useCallback(() => {
    if (pendingCheckout) void performCheckout(pendingCheckout, "preserve");
  }, [pendingCheckout, performCheckout]);
  const stashAndCheckout = useCallback(() => {
    if (pendingCheckout) void performCheckout(pendingCheckout, "stash");
  }, [pendingCheckout, performCheckout]);

  const checkoutSelected = useCallback(() => {
    const item = items[selectedIndex];
    if (item) void checkout(item);
  }, [checkout, items, selectedIndex]);

  return {
    visible,
    query,
    setQuery,
    items,
    snapshot,
    currentBranch,
    selectedIndex,
    setSelectedIndex,
    loading,
    switching,
    error,
    pendingCheckout,
    open,
    close,
    moveSelection,
    checkout,
    checkoutSelected,
    cancelPendingCheckout,
    preserveAndCheckout,
    stashAndCheckout,
    refresh: loadBranches,
  };
}

function buildBranchItems(snapshot: GitBranchSnapshot | null, query: string): GitBranchPickerItem[] {
  if (!snapshot) return [];
  const recent = new Set(snapshot.recentBranches);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (branch: GitBranch) => !normalizedQuery
    || `${branch.displayName} ${branch.upstream ?? ""}`.toLowerCase().includes(normalizedQuery);
  const items: GitBranchPickerItem[] = [];
  for (const branch of snapshot.localBranches) {
    if (recent.has(branch.name) && matches(branch)) items.push({ ...branch, group: "Recent" });
  }
  for (const branch of snapshot.localBranches) {
    if (!recent.has(branch.name) && matches(branch)) items.push({ ...branch, group: "Local" });
  }
  for (const branch of snapshot.remoteBranches) {
    if (matches(branch)) items.push({ ...branch, group: "Remote" });
  }
  return items;
}
