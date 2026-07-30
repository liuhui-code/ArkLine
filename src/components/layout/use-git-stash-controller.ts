import { useCallback, useEffect, useRef, useState } from "react";
import type { GitStashAction, GitStashEntry } from "@/features/git/git-stash-model";
import type { GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { createGitQueryId, GIT_DIFF_LIMIT_BYTES, GIT_QUERY_TIMEOUT_MS } from "@/features/git/git-query-control";
import type { GitWorkingTreeGuardController } from "@/components/layout/use-git-working-tree-guard";
import { gitMutationError, gitMutationStatus, skipGitDocumentReconciliation, type GitDocumentReconciler } from "@/components/layout/use-git-document-safety";

const STASH_PAGE_SIZE = 50;

type GitStashOperation = "idle" | "loading" | "diffing" | "creating" | "applying" | "popping" | "dropping";

type UseGitStashControllerOptions = {
  active: boolean;
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  onApplySnapshot: (snapshot: GitRepositorySnapshot) => void;
  onRefreshRepository: () => void;
  onOpenDiff: (diff: string) => void;
  onStatusChange: (message: string) => void;
  ensureWorkingTreeReady?: GitWorkingTreeGuardController["ensureReady"];
  reconcileDocuments?: GitDocumentReconciler;
};

const allowWorkingTreeMutation: GitWorkingTreeGuardController["ensureReady"] = async () => true;

export function useGitStashController({
  active,
  rootPath,
  workspaceApi,
  onApplySnapshot,
  onRefreshRepository,
  onOpenDiff,
  onStatusChange,
  ensureWorkingTreeReady = allowWorkingTreeMutation,
  reconcileDocuments = skipGitDocumentReconciliation,
}: UseGitStashControllerOptions) {
  const [entries, setEntries] = useState<GitStashEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [operation, setOperation] = useState<GitStashOperation>("idle");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<GitStashEntry | null>(null);
  const [selectedReference, setSelectedReference] = useState<string | null>(null);
  const generationRef = useRef(0);
  const diffRequestRef = useRef<string | null>(null);

  const load = useCallback(async (cursor: number | null = null, append = false) => {
    if (!rootPath || !workspaceApi.getGitStashes) {
      setEntries([]);
      setTotal(0);
      return;
    }
    const generation = ++generationRef.current;
    setOperation("loading");
    setError(null);
    try {
      const page = await workspaceApi.getGitStashes({
        rootPath,
        cursor,
        limit: STASH_PAGE_SIZE,
      });
      if (generation !== generationRef.current) return;
      setEntries((current) => append ? [...current, ...page.entries] : page.entries);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setLoaded(true);
    } catch (reason) {
      if (generation === generationRef.current) setError(errorMessage(reason));
    } finally {
      if (generation === generationRef.current) setOperation("idle");
    }
  }, [rootPath, workspaceApi]);

  useEffect(() => {
    generationRef.current += 1;
    setEntries([]);
    setTotal(0);
    setNextCursor(null);
    setHasMore(false);
    setLoaded(false);
    setError(null);
    setCreateOpen(false);
    setPendingDrop(null);
    setSelectedReference(null);
    if (diffRequestRef.current) void workspaceApi.cancelGitQuery?.(diffRequestRef.current);
    diffRequestRef.current = null;
  }, [active, load, rootPath]);

  const openDiff = useCallback(async (entry: GitStashEntry) => {
    if (!rootPath || !workspaceApi.getGitStashDiff || (operation !== "idle" && operation !== "diffing")) return;
    const requestId = createGitQueryId("git-stash-diff");
    const previous = diffRequestRef.current;
    diffRequestRef.current = requestId;
    if (previous) void workspaceApi.cancelGitQuery?.(previous);
    setSelectedReference(entry.reference);
    setOperation("diffing");
    setError(null);
    try {
      const diff = await workspaceApi.getGitStashDiff({
        rootPath,
        reference: entry.reference,
        expectedCommit: entry.commit,
        requestId,
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
        maxBytes: GIT_DIFF_LIMIT_BYTES,
      });
      if (diffRequestRef.current !== requestId) return;
      onOpenDiff(diff.content);
      onStatusChange(diff.truncated ? `Stash diff truncated: ${entry.reference}` : `Stash diff: ${entry.reference}`);
    } catch (reason) {
      if (diffRequestRef.current === requestId) setError(errorMessage(reason));
    } finally {
      if (diffRequestRef.current === requestId) {
        diffRequestRef.current = null;
        setOperation("idle");
      }
    }
  }, [onOpenDiff, onStatusChange, operation, rootPath, workspaceApi]);

  const create = useCallback(async (message: string, includeUntracked: boolean, keepIndex: boolean) => {
    if (!rootPath || !workspaceApi.createGitStash || operation !== "idle") return;
    if (!await ensureWorkingTreeReady({ actionLabel: "Create stash", paths: null })) return;
    setOperation("creating");
    setError(null);
    try {
      const result = await workspaceApi.createGitStash({ rootPath, message, includeUntracked, keepIndex });
      onApplySnapshot(result.snapshot);
      onStatusChange(gitMutationStatus(result.message, await reconcileDocuments(null)));
      setCreateOpen(false);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOperation("idle");
    }
  }, [ensureWorkingTreeReady, load, onApplySnapshot, onStatusChange, operation, reconcileDocuments, rootPath, workspaceApi]);

  const runAction = useCallback(async (entry: GitStashEntry, action: GitStashAction, restoreIndex = true) => {
    if (!rootPath || !workspaceApi.runGitStashAction || operation !== "idle") return;
    if (action !== "drop" && !await ensureWorkingTreeReady({ actionLabel: `${action === "apply" ? "Apply" : "Pop"} stash`, paths: null })) return;
    setOperation(action === "apply" ? "applying" : action === "pop" ? "popping" : "dropping");
    setError(null);
    try {
      const result = await workspaceApi.runGitStashAction({ rootPath, reference: entry.reference, expectedCommit: entry.commit, action, restoreIndex });
      onApplySnapshot(result.snapshot);
      const status = action === "drop" ? result.message : gitMutationStatus(result.message, await reconcileDocuments(null));
      onStatusChange(status);
      setPendingDrop(null);
      await load();
    } catch (reason) {
      const message = action === "drop" ? errorMessage(reason) : await gitMutationError(reason, reconcileDocuments, null);
      onRefreshRepository();
      await load();
      setError(message);
    } finally {
      setOperation("idle");
    }
  }, [ensureWorkingTreeReady, load, onApplySnapshot, onRefreshRepository, onStatusChange, operation, reconcileDocuments, rootPath, workspaceApi]);

  return {
    entries,
    total,
    hasMore,
    loaded,
    operation,
    error,
    createOpen,
    pendingDrop,
    selectedReference,
    refresh: () => void load(),
    activate: () => active && !loaded && operation === "idle" ? void load() : undefined,
    openDiff,
    loadMore: () => nextCursor !== null && operation === "idle" ? void load(nextCursor, true) : undefined,
    openCreate: () => operation === "idle" && setCreateOpen(true),
    closeCreate: () => operation === "idle" && setCreateOpen(false),
    create,
    apply: (entry: GitStashEntry) => runAction(entry, "apply"),
    pop: (entry: GitStashEntry) => runAction(entry, "pop"),
    requestDrop: (entry: GitStashEntry) => operation === "idle" && setPendingDrop(entry),
    cancelDrop: () => operation === "idle" && setPendingDrop(null),
    confirmDrop: () => pendingDrop ? runAction(pendingDrop, "drop", false) : Promise.resolve(),
  };
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export type GitStashController = ReturnType<typeof useGitStashController>;
