import { useCallback, useEffect, useRef, useState } from "react";
import type { GitCommitDetails, GitCommitSummary } from "@/features/git/git-history-model";
import type { GitPushPreview } from "@/features/git/git-push-model";
import { createGitQueryId, GIT_DIFF_LIMIT_BYTES, GIT_QUERY_TIMEOUT_MS } from "@/features/git/git-query-control";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { GitWorkingTreeGuardController } from "@/components/layout/use-git-working-tree-guard";
import { gitMutationError, gitMutationStatus, type GitDocumentReconciler } from "@/components/layout/use-git-document-safety";

type Options = {
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  onPushed: () => void | Promise<void>;
  onStatusChange: (message: string) => void;
  ensureWorkingTreeReady: GitWorkingTreeGuardController["ensureReady"];
  reconcileDocuments: GitDocumentReconciler;
};

export function useGitPushController({ rootPath, workspaceApi, onPushed, onStatusChange, ensureWorkingTreeReady, reconcileDocuments }: Options) {
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<GitPushPreview | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [details, setDetails] = useState<GitCommitDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  const requestRef = useRef<string | null>(null);
  const detailsRequestedRef = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    if (!rootPath || !workspaceApi.getGitPushPreview) {
      setError("Push preview is unavailable without an open Git repository.");
      return;
    }
    const requestId = createGitQueryId("git-push-preview");
    if (requestRef.current) void workspaceApi.cancelGitQuery?.(requestRef.current);
    requestRef.current = requestId;
    detailsRequestedRef.current = null;
    setLoading(true);
    setError(null);
    setRecoveryNeeded(false);
    try {
      const next = await workspaceApi.getGitPushPreview({ rootPath, requestId, timeoutMs: GIT_QUERY_TIMEOUT_MS });
      if (requestRef.current !== requestId) return;
      setPreview(next);
      setSelectedCommit(next.commits[0]?.commit ?? null);
      setDetails(null);
    } catch (reason) {
      if (requestRef.current === requestId) setError(errorMessage(reason));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [rootPath, workspaceApi]);

  const open = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setVisible(true);
    void load();
  }, [load]);

  const close = useCallback(() => {
    if (pushing) return;
    if (requestRef.current) void workspaceApi.cancelGitQuery?.(requestRef.current);
    setVisible(false);
    requestRef.current = null;
    queueMicrotask(() => returnFocusRef.current?.focus());
  }, [pushing, workspaceApi]);

  const selectCommit = useCallback(async (commit: GitCommitSummary) => {
    setSelectedCommit(commit.commit);
    setDetails(null);
    detailsRequestedRef.current = commit.commit;
    if (!rootPath || !workspaceApi.getGitCommitDetails) return;
    const requestId = createGitQueryId("git-push-details");
    if (requestRef.current) void workspaceApi.cancelGitQuery?.(requestRef.current);
    requestRef.current = requestId;
    try {
      const next = await workspaceApi.getGitCommitDetails({ rootPath, commit: commit.commit, requestId, timeoutMs: GIT_QUERY_TIMEOUT_MS, maxDiffBytes: GIT_DIFF_LIMIT_BYTES });
      if (requestRef.current === requestId) setDetails(next);
    } catch (reason) {
      if (requestRef.current === requestId) setError(errorMessage(reason));
    }
  }, [rootPath, workspaceApi]);

  useEffect(() => {
    const commit = preview?.commits.find((candidate) => candidate.commit === selectedCommit);
    if (visible && commit && !details && detailsRequestedRef.current !== commit.commit) void selectCommit(commit);
  }, [details, preview, selectCommit, selectedCommit, visible]);

  const runPush = useCallback(async (force = false) => {
    if (!preview || !workspaceApi.runGitRemoteOperation || pushing) return;
    setPushing(true);
    setError(null);
    try {
      const result = await workspaceApi.runGitRemoteOperation({ rootPath: preview.rootPath, operation: force ? "forcePush" : "push", remote: preview.remote, branch: preview.localBranch, timeoutMs: 120_000 });
      await onPushed();
      setVisible(false);
      onStatusChange(result.message);
      queueMicrotask(() => returnFocusRef.current?.focus());
    } catch (reason) {
      const message = errorMessage(reason);
      setRecoveryNeeded(isPushRejected(message));
      setError(pushError(message));
    } finally {
      setPushing(false);
    }
  }, [onPushed, onStatusChange, preview, pushing, workspaceApi]);

  const updateAndPush = useCallback(async (strategy: "rebase" | "merge") => {
    if (!preview || !workspaceApi.runGitRemoteOperation || pushing) return;
    if (!await ensureWorkingTreeReady({ actionLabel: `Update with ${strategy}`, paths: null })) return;
    setPushing(true);
    setError(null);
    try {
      const updated = await workspaceApi.runGitRemoteOperation({ rootPath: preview.rootPath, operation: strategy === "rebase" ? "pullRebase" : "pullMerge", remote: preview.remote, branch: preview.localBranch, timeoutMs: 120_000 });
      onStatusChange(gitMutationStatus(updated.message, await reconcileDocuments(null)));
      const result = await workspaceApi.runGitRemoteOperation({ rootPath: preview.rootPath, operation: "push", remote: preview.remote, branch: preview.localBranch, timeoutMs: 120_000 });
      await onPushed();
      setVisible(false);
      onStatusChange(result.message);
      queueMicrotask(() => returnFocusRef.current?.focus());
    } catch (reason) {
      setError(await gitMutationError(reason, reconcileDocuments, null));
    } finally {
      setPushing(false);
    }
  }, [ensureWorkingTreeReady, onPushed, onStatusChange, preview, pushing, reconcileDocuments, workspaceApi]);

  useEffect(() => {
    setVisible(false);
    setPreview(null);
    setDetails(null);
    setError(null);
    setRecoveryNeeded(false);
    detailsRequestedRef.current = null;
  }, [rootPath]);

  return { visible, preview, selectedCommit, details, loading, pushing, error, recoveryNeeded, open, close, refresh: load, selectCommit, push: () => runPush(false), forcePush: () => runPush(true), updateAndPush };
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function isPushRejected(message: string) { return /non-fast-forward|fetch first|rejected/i.test(message); }

function pushError(message: string) {
  return isPushRejected(message)
    ? `Push rejected because the remote branch has newer commits. Update with Rebase or Merge, then retry. ${message}`
    : message;
}

export type GitPushController = ReturnType<typeof useGitPushController>;
