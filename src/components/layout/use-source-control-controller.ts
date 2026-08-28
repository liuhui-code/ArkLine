import { useCallback, useEffect, useRef, useState } from "react";
import type { GitChangeEntry, GitChangeSelection, GitConflictContent, GitConflictResolution, GitDiffActionContext, GitFileComparison, GitFileDiffRequest, GitPatchAction, GitRemoteOperation, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { GitCommitAction } from "@/features/git/git-commit-model";
import { useGitHistoryController } from "@/components/layout/use-git-history-controller";
import { useGitCommitDraft } from "@/components/layout/use-git-commit-draft";
import { useGitStashController } from "@/components/layout/use-git-stash-controller";
import { createGitQueryId, GIT_DIFF_LIMIT_BYTES, GIT_QUERY_TIMEOUT_MS, GIT_STATUS_PAGE_SIZE } from "@/features/git/git-query-control";
import { useGitWorkingTreeGuard } from "@/components/layout/use-git-working-tree-guard";
import type { SourceControlOperation, UseSourceControlControllerOptions } from "@/components/layout/source-control-controller-types";
import { gitMutationError, gitMutationStatus, skipGitDocumentReconciliation } from "@/components/layout/use-git-document-safety";

const noDirtyDocuments = () => [];
const saveNoDocuments = async (_paths: string[]) => undefined;
export function useSourceControlController({ active, rootPath, workspaceApi, onOpenDiff, onStatusChange,
  onCommitComplete,
  getDirtyDocumentPaths = noDirtyDocuments, saveDirtyDocuments = saveNoDocuments,
  reconcileDocuments = skipGitDocumentReconciliation }: UseSourceControlControllerOptions) {
  const [snapshot, setSnapshot] = useState<GitRepositorySnapshot | null>(null);
  const [selected, setSelected] = useState<GitChangeSelection | null>(null);
  const [operation, setOperation] = useState<SourceControlOperation>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMoreChanges, setLoadingMoreChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const [conflictContent, setConflictContent] = useState<GitConflictContent | null>(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<GitChangeEntry | null>(null);
  const [discardBackup, setDiscardBackup] = useState<{ commit: string; path: string; patch?: string } | null>(null);
  const requestGenerationRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const snapshotRef = useRef<GitRepositorySnapshot | null>(null);
  const statusRequestRef = useRef<string | null>(null);
  const diffRequestRef = useRef<string | null>(null);
  const commitDraft = useGitCommitDraft(rootPath, workspaceApi);
  const dirtyGuard = useGitWorkingTreeGuard({ rootPath, getDirtyDocumentPaths, saveDirtyDocuments });

  const stagedCount = snapshot?.stagedChanges ?? 0;
  const changeCount = snapshot?.totalChanges ?? 0;
  const branchLabel = snapshot?.currentBranch ?? (snapshot?.detached ? "Detached HEAD" : "No Git branch");

  const applySnapshot = useCallback((next: GitRepositorySnapshot, append = false) => {
    const current = snapshotRef.current;
    if (current && next.generation < current.generation) return false;
    if (append && current?.snapshotId !== next.snapshotId) return false;
    const applied = append && current
      ? { ...next, changes: [...current.changes, ...next.changes] }
      : next;
    snapshotRef.current = applied;
    setSnapshot(applied);
    setSelected((current) => {
      if (!current) return null;
      const entry = applied.changes.find((candidate) => candidate.relativePath === current.entry.relativePath);
      if (!entry || (current.staged ? !entry.staged : !entry.unstaged)) return null;
      return { entry, staged: current.staged };
    });
    return true;
  }, []);

  const history = useGitHistoryController({ rootPath, workspaceApi, onOpenDiff, onApplySnapshot: applySnapshot, onStatusChange, ensureWorkingTreeReady: dirtyGuard.ensureReady, reconcileDocuments });
  const invalidateHistory = history.invalidate;

  const refresh = useCallback(async (cursor: string | null = null, append = false) => {
    if (!rootPath || !workspaceApi.getGitRepositorySnapshot) {
      snapshotRef.current = null;
      setSnapshot(null);
      return;
    }
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const requestGeneration = ++requestGenerationRef.current;
    const requestId = createGitQueryId(append ? "git-status-page" : "git-status");
    const previousRequest = statusRequestRef.current;
    statusRequestRef.current = requestId;
    if (previousRequest) void workspaceApi.cancelGitQuery?.(previousRequest);
    append ? setLoadingMoreChanges(true) : setRefreshing(true);
    setRefreshError(null);
    try {
      const next = await workspaceApi.getGitRepositorySnapshot({
        rootPath,
        cursor,
        limit: GIT_STATUS_PAGE_SIZE,
        requestId,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
      });
      if (requestGeneration === requestGenerationRef.current && !applySnapshot(next, append) && append) {
        setRefreshError("Working tree changed while loading more files. Refresh to restart the list.");
        queueMicrotask(() => void refresh());
      }
    } catch (reason) {
      if (requestGeneration === requestGenerationRef.current) {
        setRefreshError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (statusRequestRef.current === requestId) {
        statusRequestRef.current = null;
        refreshInFlightRef.current = false;
      }
      if (requestGeneration === requestGenerationRef.current) {
        setRefreshing(false);
        setLoadingMoreChanges(false);
      }
    }
  }, [applySnapshot, rootPath, workspaceApi]);

  const stash = useGitStashController({
    active,
    rootPath,
    workspaceApi,
    onApplySnapshot: applySnapshot,
    onRefreshRepository: () => void refresh(),
    onOpenDiff: (diff) => onOpenDiff(diff),
    onStatusChange,
    ensureWorkingTreeReady: dirtyGuard.ensureReady,
    reconcileDocuments,
  });

  useEffect(() => {
    if (statusRequestRef.current) void workspaceApi.cancelGitQuery?.(statusRequestRef.current);
    if (diffRequestRef.current) void workspaceApi.cancelGitQuery?.(diffRequestRef.current);
    requestGenerationRef.current += 1;
    refreshInFlightRef.current = false;
    statusRequestRef.current = null;
    diffRequestRef.current = null;
    snapshotRef.current = null;
    setSnapshot(null);
    setSelected(null);
    setError(null);
    setRefreshError(null);
    setConflictPath(null);
    setConflictContent(null);
    setConflictError(null);
    setPendingDiscard(null);
    setDiscardBackup(null);
    void refresh();
  }, [refresh, rootPath, workspaceApi]);

  useEffect(() => {
    if (!active) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(refreshWhenVisible, 10_000);
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [active, refresh]);

  const openDiff = useCallback(async (selection: GitChangeSelection) => {
    if (!rootPath || (!workspaceApi.getGitFileComparison && !workspaceApi.getGitFileDiff)) return;
    setSelected(selection);
    setOperation("diff");
    setError(null);
    const requestId = createGitQueryId("git-file-diff");
    const previousRequest = diffRequestRef.current;
    diffRequestRef.current = requestId;
    if (previousRequest) void workspaceApi.cancelGitQuery?.(previousRequest);
    try {
      const request: GitFileDiffRequest = {
        rootPath,
        relativePath: selection.entry.relativePath,
        originalPath: selection.entry.originalPath,
        staged: selection.staged,
        scope: selection.commitView ? "commit" : selection.staged ? "index" : "workingTree",
        requestId,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
        maxBytes: GIT_DIFF_LIMIT_BYTES,
      };
      let comparison: GitFileComparison | undefined;
      try {
        comparison = await workspaceApi.getGitFileComparison?.(request);
      } catch (reason) {
        if (diffRequestRef.current !== requestId || !workspaceApi.getGitFileDiff) throw reason;
      }
      const diff = comparison?.patch ?? await workspaceApi.getGitFileDiff!(request);
      if (diffRequestRef.current !== requestId) return;
      onOpenDiff(diff.content, {
        relativePath: selection.entry.relativePath,
        staged: selection.commitView ? false : selection.staged,
        kind: selection.entry.kind,
      }, comparison ?? null);
      onStatusChange(diff.truncated
        ? `Diff truncated at ${GIT_DIFF_LIMIT_BYTES / 1024 / 1024} MiB: ${selection.entry.relativePath}`
        : diff.content ? `Diff: ${selection.entry.relativePath}` : "No diff for selected change");
    } catch (reason) {
      if (diffRequestRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (diffRequestRef.current === requestId) {
        diffRequestRef.current = null;
        setOperation("idle");
      }
    }
  }, [onOpenDiff, onStatusChange, rootPath, workspaceApi]);

  const mutatePaths = useCallback(async (kind: "stage" | "unstage", paths: string[]) => {
    if (!rootPath) return;
    const method = kind === "stage" ? workspaceApi.stageGitPaths : workspaceApi.unstageGitPaths;
    if (!method) return;
    setOperation(kind);
    setError(null);
    try {
      const result = await method({ rootPath, paths });
      applySnapshot(result.snapshot);
      onStatusChange(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, onStatusChange, rootPath, workspaceApi]);

  const applyPartialPatch = useCallback(async (action: GitPatchAction, patch: string, context: GitDiffActionContext) => {
    if (!rootPath || !workspaceApi.applyGitPartialPatch || operation !== "idle") return;
    if (action === "discard" && !await dirtyGuard.ensureReady({ actionLabel: "Discard selected changes", paths: [context.relativePath] })) return;
    if (operation !== "idle") return;
    setOperation(action === "discard" ? "discard" : action);
    setError(null);
    try {
      const result = await workspaceApi.applyGitPartialPatch({
        rootPath,
        relativePath: context.relativePath,
        patch,
        action,
      });
      applySnapshot(result.snapshot);
      const status = action === "discard" ? gitMutationStatus(result.message, await reconcileDocuments([context.relativePath])) : result.message;
      if (action === "discard" && result.backupCommit) {
        setDiscardBackup({ commit: result.backupCommit, path: context.relativePath, patch });
      }
      const entry = result.snapshot.changes.find((candidate) => candidate.relativePath === context.relativePath);
      if (entry && (context.staged ? entry.staged : entry.unstaged)) {
        await openDiff({ entry, staged: context.staged });
      } else {
        onOpenDiff("", context);
      }
      onStatusChange(status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, dirtyGuard.ensureReady, onOpenDiff, onStatusChange, openDiff, operation, reconcileDocuments, rootPath, workspaceApi]);

  const requestDiscard = useCallback((entry: GitChangeEntry) => {
    if (entry.unstaged && operation === "idle") setPendingDiscard(entry);
  }, [operation]);

  const confirmDiscard = useCallback(async () => {
    if (!rootPath || !pendingDiscard || !workspaceApi.discardGitPaths || operation !== "idle") return;
    if (!await dirtyGuard.ensureReady({ actionLabel: "Discard file changes", paths: [pendingDiscard.relativePath] })) return;
    if (operation !== "idle") return;
    setOperation("discard");
    setError(null);
    try {
      const result = await workspaceApi.discardGitPaths({
        rootPath,
        paths: [pendingDiscard.relativePath],
      });
      applySnapshot(result.snapshot);
      const status = gitMutationStatus(result.message, await reconcileDocuments([pendingDiscard.relativePath]));
      setDiscardBackup({ commit: result.backupCommit, path: pendingDiscard.relativePath });
      setPendingDiscard(null);
      onStatusChange(status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, dirtyGuard.ensureReady, onStatusChange, operation, pendingDiscard, reconcileDocuments, rootPath, workspaceApi]);

  const restoreDiscard = useCallback(async () => {
    if (!rootPath || !discardBackup || operation !== "idle") return;
    if (!await dirtyGuard.ensureReady({ actionLabel: "Restore discarded changes", paths: [discardBackup.path] })) return;
    if (operation !== "idle") return;
    setOperation("restoreDiscard");
    setError(null);
    try {
      const result = discardBackup.patch && workspaceApi.restoreGitPartialPatch
        ? await workspaceApi.restoreGitPartialPatch({ rootPath, backupCommit: discardBackup.commit, relativePath: discardBackup.path, patch: discardBackup.patch })
        : await workspaceApi.restoreGitDiscard?.({ rootPath, backupCommit: discardBackup.commit, paths: [discardBackup.path] });
      if (!result) return;
      applySnapshot(result.snapshot);
      const status = gitMutationStatus(result.message, await reconcileDocuments([discardBackup.path]));
      setDiscardBackup(null);
      if (discardBackup.patch) {
        const entry = result.snapshot.changes.find((candidate) => candidate.relativePath === discardBackup.path);
        if (entry?.unstaged) await openDiff({ entry, staged: false });
      }
      onStatusChange(status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, dirtyGuard.ensureReady, discardBackup, onStatusChange, openDiff, operation, reconcileDocuments, rootPath, workspaceApi]);

  const commit = useCallback(async (action: GitCommitAction = "commit") => {
    if (!rootPath || !workspaceApi.commitGitChanges || operation !== "idle") return;
    setOperation("commit");
    setError(null);
    try {
      const result = await workspaceApi.commitGitChanges({
        rootPath,
        message: commitDraft.draft.message,
        amend: commitDraft.draft.amend,
        signOff: commitDraft.draft.signOff,
      });
      applySnapshot(result.snapshot);
      invalidateHistory();
      commitDraft.clear();
      onStatusChange(result.message);
      onCommitComplete?.(action, result.snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, commitDraft, invalidateHistory, onCommitComplete, onStatusChange, operation, rootPath, workspaceApi]);

  const runRemoteOperation = useCallback(async (kind: GitRemoteOperation) => {
    if (!rootPath || !workspaceApi.runGitRemoteOperation || operation !== "idle") return;
    if (kind === "pull" && !await dirtyGuard.ensureReady({ actionLabel: "Pull remote changes", paths: null })) return;
    if (operation !== "idle") return;
    setOperation(kind);
    setError(null);
    try {
      const result = await workspaceApi.runGitRemoteOperation({
        rootPath,
        operation: kind,
        remote: null,
        branch: snapshot?.currentBranch ?? null,
        timeoutMs: 120_000,
      });
      applySnapshot(result.snapshot);
      invalidateHistory();
      const status = kind === "pull" ? gitMutationStatus(result.message, await reconcileDocuments(null)) : result.message;
      onStatusChange(status);
    } catch (reason) {
      setError(kind === "pull" ? await gitMutationError(reason, reconcileDocuments, null) : reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, dirtyGuard.ensureReady, invalidateHistory, onStatusChange, operation, reconcileDocuments, rootPath, snapshot?.currentBranch, workspaceApi]);

  const openConflict = useCallback(async (entry: GitChangeEntry) => {
    if (!rootPath || !workspaceApi.getGitConflictContent || operation !== "idle") return;
    setConflictPath(entry.relativePath);
    setConflictContent(null);
    setConflictError(null);
    setConflictLoading(true);
    setOperation("conflict");
    try {
      setConflictContent(await workspaceApi.getGitConflictContent({ rootPath, relativePath: entry.relativePath }));
    } catch (reason) {
      setConflictError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setConflictLoading(false);
      setOperation("idle");
    }
  }, [operation, rootPath, workspaceApi]);

  const closeConflict = useCallback(() => {
    if (operation === "resolveConflict") return;
    setConflictPath(null);
    setConflictContent(null);
    setConflictError(null);
  }, [operation]);

  const resolveConflict = useCallback(async (resolution: GitConflictResolution, content: string | null) => {
    if (!rootPath || !conflictPath || !workspaceApi.resolveGitConflict || operation !== "idle") return;
    if (!await dirtyGuard.ensureReady({ actionLabel: "Resolve file conflict", paths: [conflictPath] })) return;
    if (operation !== "idle") return;
    setOperation("resolveConflict");
    setConflictError(null);
    try {
      const result = await workspaceApi.resolveGitConflict({ rootPath, relativePath: conflictPath, resolution, content });
      applySnapshot(result.snapshot);
      invalidateHistory();
      const status = gitMutationStatus(result.message, await reconcileDocuments([conflictPath]));
      setConflictPath(null);
      setConflictContent(null);
      onStatusChange(status);
    } catch (reason) {
      setConflictError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, conflictPath, dirtyGuard.ensureReady, invalidateHistory, onStatusChange, operation, reconcileDocuments, rootPath, workspaceApi]);

  const runRepositoryAction = useCallback(async (action: "continue" | "abort") => {
    if (!rootPath || !workspaceApi.runGitRepositoryAction || operation !== "idle") return;
    if (!await dirtyGuard.ensureReady({ actionLabel: `${action === "continue" ? "Continue" : "Abort"} Git operation`, paths: null })) return;
    if (operation !== "idle") return;
    setOperation(action);
    setError(null);
    try {
      const result = await workspaceApi.runGitRepositoryAction({ rootPath, action });
      applySnapshot(result.snapshot);
      invalidateHistory();
      onStatusChange(gitMutationStatus(result.message, await reconcileDocuments(null)));
    } catch (reason) {
      setError(await gitMutationError(reason, reconcileDocuments, null));
    } finally {
      setOperation("idle");
    }
  }, [applySnapshot, dirtyGuard.ensureReady, invalidateHistory, onStatusChange, operation, reconcileDocuments, rootPath, workspaceApi]);

  const stage = useCallback((entry: GitChangeEntry) => void mutatePaths("stage", [entry.relativePath]), [mutatePaths]);
  const unstage = useCallback((entry: GitChangeEntry) => void mutatePaths("unstage", [entry.relativePath]), [mutatePaths]);
  const stageAll = useCallback(() => {
    const paths = snapshot?.changes.filter((entry) => entry.unstaged && !entry.conflicted).map((entry) => entry.relativePath) ?? [];
    if (paths.length) void mutatePaths("stage", paths);
  }, [mutatePaths, snapshot]);
  const unstageAll = useCallback(() => {
    const paths = snapshot?.changes.filter((entry) => entry.staged && !entry.conflicted).map((entry) => entry.relativePath) ?? [];
    if (paths.length) void mutatePaths("unstage", paths);
  }, [mutatePaths, snapshot]);
  const fetchRemote = useCallback(() => runRemoteOperation("fetch"), [runRemoteOperation]);
  const pullRemote = useCallback(() => runRemoteOperation("pull"), [runRemoteOperation]);
  const pushRemote = useCallback(() => runRemoteOperation("push"), [runRemoteOperation]);
  const refreshRepository = useCallback(() => void refresh(), [refresh]);
  const loadMoreChanges = useCallback(() => {
    if (snapshot?.hasMore && snapshot.nextCursor && !loadingMoreChanges) {
      void refresh(snapshot.nextCursor, true);
    }
  }, [loadingMoreChanges, refresh, snapshot?.hasMore, snapshot?.nextCursor]);

  return {
    snapshot,
    selected,
    commitDraft: commitDraft.draft,
    setCommitMessage: commitDraft.setMessage,
    setCommitAmend: commitDraft.setAmend,
    setCommitSignOff: commitDraft.setSignOff,
    loadingAmendMessage: commitDraft.loadingAmendMessage,
    operation: operation === "idle" && refreshing ? "refreshing" : operation,
    error: error ?? commitDraft.error ?? refreshError,
    branchLabel,
    changeCount,
    loadingMoreChanges,
    stagedCount,
    refresh: refreshRepository,
    loadMoreChanges,
    openDiff,
    stage,
    unstage,
    stageAll,
    unstageAll,
    applyPartialPatch,
    commit,
    fetchRemote,
    pullRemote,
    pushRemote,
    dirtyGuard,
    history,
    stash,
    discard: {
      pending: pendingDiscard,
      backup: discardBackup,
      discarding: operation === "discard",
      restoring: operation === "restoreDiscard",
      request: requestDiscard,
      cancel: () => operation === "idle" && setPendingDiscard(null),
      confirm: confirmDiscard,
      restore: restoreDiscard,
      dismissBackup: () => setDiscardBackup(null),
    },
    conflict: {
      path: conflictPath,
      content: conflictContent,
      loading: conflictLoading,
      saving: operation === "resolveConflict",
      error: conflictError,
      open: openConflict,
      close: closeConflict,
      resolve: resolveConflict,
      continueOperation: () => runRepositoryAction("continue"),
      abortOperation: () => runRepositoryAction("abort"),
    },
  };
}

export type SourceControlConflictController = ReturnType<typeof useSourceControlController>["conflict"];
export type SourceControlDiscardController = ReturnType<typeof useSourceControlController>["discard"];
