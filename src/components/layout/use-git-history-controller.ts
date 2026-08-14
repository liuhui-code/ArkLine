import { useCallback, useEffect, useRef, useState } from "react";
import type { GitCommitDetails, GitCommitFile, GitCommitSummary, GitHistoryAction } from "@/features/git/git-history-model";
import type { GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { createGitQueryId, GIT_DIFF_LIMIT_BYTES, GIT_QUERY_TIMEOUT_MS } from "@/features/git/git-query-control";
import type { GitWorkingTreeGuardController } from "@/components/layout/use-git-working-tree-guard";
import { gitMutationStatus, skipGitDocumentReconciliation, type GitDocumentReconciler } from "@/components/layout/use-git-document-safety";

type GitHistoryStatus = "idle" | "loading" | "ready" | "error";

type UseGitHistoryControllerOptions = {
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  onOpenDiff: (diff: string) => void;
  onApplySnapshot: (snapshot: GitRepositorySnapshot) => void;
  onStatusChange: (message: string) => void;
  ensureWorkingTreeReady?: GitWorkingTreeGuardController["ensureReady"];
  reconcileDocuments?: GitDocumentReconciler;
};

const allowWorkingTreeMutation: GitWorkingTreeGuardController["ensureReady"] = async () => true;

export function useGitHistoryController({
  rootPath,
  workspaceApi,
  onOpenDiff,
  onApplySnapshot,
  onStatusChange,
  ensureWorkingTreeReady = allowWorkingTreeMutation,
  reconcileDocuments = skipGitDocumentReconciliation,
}: UseGitHistoryControllerOptions) {
  const [commits, setCommits] = useState<GitCommitSummary[]>([]);
  const [refName, setRefName] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<GitHistoryStatus>("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [details, setDetails] = useState<GitCommitDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<GitHistoryAction | null>(null);
  const [actionStatus, setActionStatus] = useState<GitHistoryAction | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const historyRequestRef = useRef<string | null>(null);
  const detailRequestRef = useRef<string | null>(null);
  const diffRequestRef = useRef<string | null>(null);
  const detailsCacheRef = useRef(new Map<string, GitCommitDetails>());

  const reset = useCallback(() => {
    for (const requestId of [historyRequestRef.current, detailRequestRef.current, diffRequestRef.current]) {
      if (requestId) void workspaceApi.cancelGitQuery?.(requestId);
    }
    historyRequestRef.current = null;
    detailRequestRef.current = null;
    diffRequestRef.current = null;
    requestGenerationRef.current += 1;
    detailGenerationRef.current += 1;
    detailsCacheRef.current.clear();
    setRefName(null);
    setCommits([]);
    setNextCursor(null);
    setHasMore(false);
    setStatus("idle");
    setLoadingMore(false);
    setSelectedCommit(null);
    setDetails(null);
    setDetailsLoading(false);
    setSelectedFilePath(null);
    setDiffLoading(false);
    setPendingAction(null);
    setActionStatus("idle");
    setError(null);
  }, [workspaceApi]);

  useEffect(() => reset(), [reset, rootPath]);

  const loadPage = useCallback(async (cursor: string | null, append: boolean, requestedRef = refName) => {
    if (!rootPath || !workspaceApi.getGitHistory) return;
    const generation = ++requestGenerationRef.current;
    const requestId = createGitQueryId("git-history");
    if (historyRequestRef.current) void workspaceApi.cancelGitQuery?.(historyRequestRef.current);
    historyRequestRef.current = requestId;
    append ? setLoadingMore(true) : setStatus("loading");
    setError(null);
    try {
      const page = await workspaceApi.getGitHistory({
        rootPath,
        refName: requestedRef,
        cursor,
        limit: 40,
        requestId,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
      });
      if (generation !== requestGenerationRef.current) return;
      setCommits((current) => append ? [...current, ...page.commits] : page.commits);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setStatus("ready");
    } catch (reason) {
      if (generation !== requestGenerationRef.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      if (!append) setStatus("error");
    } finally {
      if (historyRequestRef.current === requestId) historyRequestRef.current = null;
      if (generation === requestGenerationRef.current) setLoadingMore(false);
    }
  }, [refName, rootPath, workspaceApi]);

  const loadInitial = useCallback(() => {
    if (status === "idle") void loadPage(null, false);
  }, [loadPage, status]);
  const refresh = useCallback(() => loadPage(null, false), [loadPage]);
  const loadMore = useCallback(() => {
    if (hasMore && nextCursor && !loadingMore) void loadPage(nextCursor, true);
  }, [hasMore, loadPage, loadingMore, nextCursor]);
  const selectRef = useCallback((next: string | null) => {
    setRefName(next);
    setSelectedCommit(null);
    setDetails(null);
    void loadPage(null, false, next);
  }, [loadPage]);

  const selectCommit = useCallback(async (commit: GitCommitSummary) => {
    const generation = ++detailGenerationRef.current;
    if (detailRequestRef.current) void workspaceApi.cancelGitQuery?.(detailRequestRef.current);
    if (diffRequestRef.current) void workspaceApi.cancelGitQuery?.(diffRequestRef.current);
    detailRequestRef.current = null;
    diffRequestRef.current = null;
    setSelectedCommit(commit.commit);
    setDetails(null);
    setDetailsLoading(false);
    setSelectedFilePath(null);
    setDiffLoading(false);
    setError(null);
    const cached = detailsCacheRef.current.get(commit.commit);
    if (cached) {
      setDetails(cached);
      setDetailsLoading(false);
      setSelectedFilePath(cached.files[0]?.path ?? null);
      return;
    }
    if (!rootPath || !workspaceApi.getGitCommitDetails) return;
    const requestId = createGitQueryId("git-commit-details");
    detailRequestRef.current = requestId;
    setDetails(null);
    setDetailsLoading(true);
    try {
      const next = await workspaceApi.getGitCommitDetails({
        rootPath,
        commit: commit.commit,
        requestId,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
        maxDiffBytes: GIT_DIFF_LIMIT_BYTES,
      });
      if (generation !== detailGenerationRef.current) return;
      detailsCacheRef.current.set(commit.commit, next);
      setDetails(next);
      setSelectedFilePath(next.files[0]?.path ?? null);
    } catch (reason) {
      if (generation === detailGenerationRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (detailRequestRef.current === requestId) detailRequestRef.current = null;
      if (generation === detailGenerationRef.current) setDetailsLoading(false);
    }
  }, [rootPath, workspaceApi]);

  const openCommitDiff = useCallback(async () => {
    if (!rootPath || !selectedCommit || !workspaceApi.getGitCommitDiff) return;
    setDiffLoading(true);
    setSelectedFilePath(null);
    setError(null);
    const requestId = createGitQueryId("git-commit-diff");
    if (diffRequestRef.current) void workspaceApi.cancelGitQuery?.(diffRequestRef.current);
    diffRequestRef.current = requestId;
    try {
      const diff = await workspaceApi.getGitCommitDiff({
        rootPath,
        commit: selectedCommit,
        requestId,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
        maxDiffBytes: GIT_DIFF_LIMIT_BYTES,
      });
      if (diffRequestRef.current !== requestId) return;
      onOpenDiff(diff.content);
      onStatusChange(diff.truncated
        ? `Commit diff truncated: ${selectedCommit.slice(0, 7)}`
        : `Commit diff: ${selectedCommit.slice(0, 7)}`);
    } catch (reason) {
      if (diffRequestRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (diffRequestRef.current === requestId) {
        diffRequestRef.current = null;
        setDiffLoading(false);
      }
    }
  }, [onOpenDiff, onStatusChange, rootPath, selectedCommit, workspaceApi]);

  const selectCommitFile = useCallback((file: GitCommitFile) => {
    setSelectedFilePath(file.path);
  }, []);

  const openCommitFileDiff = useCallback(async (file: GitCommitFile) => {
    if (!rootPath || !selectedCommit || !workspaceApi.getGitCommitFileDiff) return;
    setSelectedFilePath(file.path);
    setDiffLoading(true);
    setError(null);
    const requestId = createGitQueryId("git-commit-file-diff");
    if (diffRequestRef.current) void workspaceApi.cancelGitQuery?.(diffRequestRef.current);
    diffRequestRef.current = requestId;
    try {
      const diff = await workspaceApi.getGitCommitFileDiff({
        rootPath,
        commit: selectedCommit,
        relativePath: file.path,
        previousPath: file.previousPath,
        requestId,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
        maxDiffBytes: GIT_DIFF_LIMIT_BYTES,
      });
      if (diffRequestRef.current !== requestId) return;
      onOpenDiff(diff.content);
      onStatusChange(diff.truncated
        ? `File diff truncated: ${file.path}`
        : `Commit file diff: ${file.path}`);
    } catch (reason) {
      if (diffRequestRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (diffRequestRef.current === requestId) {
        diffRequestRef.current = null;
        setDiffLoading(false);
      }
    }
  }, [onOpenDiff, onStatusChange, rootPath, selectedCommit, workspaceApi]);

  const requestCommitAction = useCallback((action: GitHistoryAction) => {
    if (selectedCommit && actionStatus === "idle") setPendingAction(action);
  }, [actionStatus, selectedCommit]);

  const confirmCommitAction = useCallback(async () => {
    if (!rootPath || !selectedCommit || !pendingAction || !workspaceApi.runGitHistoryAction || actionStatus !== "idle") return;
    const action = pendingAction;
    if (!await ensureWorkingTreeReady({ actionLabel: action === "cherryPick" ? "Cherry-pick commit" : "Revert commit", paths: null })) return;
    setPendingAction(null);
    setActionStatus(action);
    setError(null);
    try {
      const result = await workspaceApi.runGitHistoryAction({ rootPath, commit: selectedCommit, action });
      onApplySnapshot(result.snapshot);
      const reconciliation = await reconcileDocuments(null);
      detailsCacheRef.current.clear();
      await loadPage(null, false);
      onStatusChange(gitMutationStatus(result.snapshot.operation === "idle"
        ? result.message
        : `${result.message}. Resolve conflicts in Changes.`, reconciliation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionStatus("idle");
    }
  }, [actionStatus, ensureWorkingTreeReady, loadPage, onApplySnapshot, onStatusChange, pendingAction, reconcileDocuments, rootPath, selectedCommit, workspaceApi]);

  const copyCommitHash = useCallback(async () => {
    if (!details?.commit) return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard is unavailable");
      await navigator.clipboard.writeText(details.commit);
      onStatusChange(`Copied commit ${details.shortCommit}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [details, onStatusChange]);

  return {
    commits,
    refName,
    status,
    loadingMore,
    hasMore,
    selectedCommit,
    details,
    detailsLoading,
    selectedFilePath,
    diffLoading,
    pendingAction,
    actionStatus,
    error,
    loadInitial,
    refresh,
    loadMore,
    selectRef,
    selectCommit,
    selectCommitFile,
    openCommitDiff,
    openCommitFileDiff,
    requestCommitAction,
    cancelCommitAction: () => actionStatus === "idle" && setPendingAction(null),
    confirmCommitAction,
    copyCommitHash,
    invalidate: reset,
  };
}

export type GitHistoryController = ReturnType<typeof useGitHistoryController>;
