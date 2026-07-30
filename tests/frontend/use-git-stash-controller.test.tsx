import { act, renderHook, waitFor } from "@testing-library/react";
import { useGitStashController } from "@/components/layout/use-git-stash-controller";
import type { GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

const snapshot: GitRepositorySnapshot = {
  rootPath: "/workspace",
  repositoryRoot: "/workspace",
  currentBranch: "main",
  detached: false,
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  operation: "idle",
  generation: 2,
  snapshotId: "snapshot-2",
  totalChanges: 0,
  stagedChanges: 0,
  conflictedChanges: 0,
  nextCursor: null,
  hasMore: false,
  changes: [],
};

const entry = {
  index: 0,
  reference: "stash@{0}",
  commit: "abc123",
  subject: "On main: Pause work",
  createdAtEpochSeconds: 1785283200,
};

describe("useGitStashController", () => {
  it("loads pages and creates an interoperable Git stash", async () => {
    const getGitStashes = vi.fn()
      .mockResolvedValueOnce({ entries: [entry], total: 2, nextCursor: 1, hasMore: true })
      .mockResolvedValueOnce({ entries: [{ ...entry, index: 1, reference: "stash@{1}", commit: "def456" }], total: 2, nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ entries: [entry], total: 1, nextCursor: null, hasMore: false });
    const createGitStash = vi.fn().mockResolvedValue({ message: "Stashed local changes", snapshot });
    const onApplySnapshot = vi.fn();
    const reconcileDocuments = vi.fn().mockResolvedValue({ updatedPaths: [], deletedPaths: [], conflictPaths: [], failedPaths: [] });
    const workspaceApi = { getGitStashes, createGitStash } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitStashController({
      active: true,
      rootPath: "/workspace",
      workspaceApi,
      onApplySnapshot,
      onRefreshRepository: vi.fn(),
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
      reconcileDocuments,
    }));
    act(() => result.current.activate());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    await act(async () => result.current.create("Pause editor", true, false));

    expect(createGitStash).toHaveBeenCalledWith({ rootPath: "/workspace", message: "Pause editor", includeUntracked: true, keepIndex: false });
    expect(onApplySnapshot).toHaveBeenCalledWith(snapshot);
    expect(reconcileDocuments).toHaveBeenCalledWith(null);
  });

  it("refreshes repository state when applying a stash reports conflicts", async () => {
    const getGitStashes = vi.fn().mockResolvedValue({ entries: [entry], total: 1, nextCursor: null, hasMore: false });
    const runGitStashAction = vi.fn().mockRejectedValue(new Error("Stash apply produced conflicts"));
    const onRefreshRepository = vi.fn();
    const reconcileDocuments = vi.fn().mockResolvedValue({ updatedPaths: [], deletedPaths: [], conflictPaths: ["/workspace/conflict.ets"], failedPaths: [] });
    const workspaceApi = { getGitStashes, runGitStashAction } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitStashController({
      active: true,
      rootPath: "/workspace",
      workspaceApi,
      onApplySnapshot: vi.fn(),
      onRefreshRepository,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
      reconcileDocuments,
    }));
    act(() => result.current.activate());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await act(async () => result.current.apply(entry));

    expect(runGitStashAction).toHaveBeenCalledWith({ rootPath: "/workspace", reference: "stash@{0}", expectedCommit: "abc123", action: "apply", restoreIndex: true });
    expect(result.current.error).toBe("Stash apply produced conflicts. 1 open file needs attention");
    expect(reconcileDocuments).toHaveBeenCalledWith(null);
    expect(onRefreshRepository).toHaveBeenCalledOnce();
  });

  it("blocks stash create and apply while unsaved documents are not ready", async () => {
    const createGitStash = vi.fn();
    const runGitStashAction = vi.fn();
    const ensureWorkingTreeReady = vi.fn().mockResolvedValue(false);
    const workspaceApi = { createGitStash, runGitStashAction } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitStashController({
      active: true,
      rootPath: "/workspace",
      workspaceApi,
      onApplySnapshot: vi.fn(),
      onRefreshRepository: vi.fn(),
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
      ensureWorkingTreeReady,
    }));

    await act(async () => result.current.create("Pause work", false, false));
    await act(async () => result.current.apply(entry));

    expect(ensureWorkingTreeReady).toHaveBeenNthCalledWith(1, { actionLabel: "Create stash", paths: null });
    expect(ensureWorkingTreeReady).toHaveBeenNthCalledWith(2, { actionLabel: "Apply stash", paths: null });
    expect(createGitStash).not.toHaveBeenCalled();
    expect(runGitStashAction).not.toHaveBeenCalled();
  });

  it("loads a bounded stash diff and selects only the current request", async () => {
    const getGitStashes = vi.fn().mockResolvedValue({ entries: [entry], total: 1, nextCursor: null, hasMore: false });
    const getGitStashDiff = vi.fn().mockResolvedValue({ content: "diff --git a/tracked.ets b/tracked.ets", truncated: false, totalBytes: 42 });
    const onOpenDiff = vi.fn();
    const workspaceApi = { getGitStashes, getGitStashDiff, cancelGitQuery: vi.fn() } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitStashController({
      active: true,
      rootPath: "/workspace",
      workspaceApi,
      onApplySnapshot: vi.fn(),
      onRefreshRepository: vi.fn(),
      onOpenDiff,
      onStatusChange: vi.fn(),
    }));
    act(() => result.current.activate());
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await act(async () => result.current.openDiff(entry));

    expect(getGitStashDiff).toHaveBeenCalledWith(expect.objectContaining({ reference: "stash@{0}", expectedCommit: "abc123", maxBytes: 4 * 1024 * 1024 }));
    expect(onOpenDiff).toHaveBeenCalledWith("diff --git a/tracked.ets b/tracked.ets");
    expect(result.current.selectedReference).toBe("stash@{0}");
  });

  it("cancels an obsolete preview and ignores its late result", async () => {
    const secondEntry = { ...entry, index: 1, reference: "stash@{1}", commit: "def456", subject: "On main: Second" };
    const first = deferred<{ content: string; truncated: boolean; totalBytes: number }>();
    const second = deferred<{ content: string; truncated: boolean; totalBytes: number }>();
    const getGitStashes = vi.fn().mockResolvedValue({ entries: [entry, secondEntry], total: 2, nextCursor: null, hasMore: false });
    const getGitStashDiff = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const cancelGitQuery = vi.fn().mockResolvedValue(true);
    const onOpenDiff = vi.fn();
    const workspaceApi = { getGitStashes, getGitStashDiff, cancelGitQuery } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitStashController({
      active: true,
      rootPath: "/workspace",
      workspaceApi,
      onApplySnapshot: vi.fn(),
      onRefreshRepository: vi.fn(),
      onOpenDiff,
      onStatusChange: vi.fn(),
    }));
    act(() => result.current.activate());
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    let firstRun: Promise<void> | undefined;
    act(() => { firstRun = result.current.openDiff(entry); });
    await waitFor(() => expect(result.current.operation).toBe("diffing"));
    let secondRun: Promise<void> | undefined;
    act(() => { secondRun = result.current.openDiff(secondEntry); });
    second.resolve({ content: "second diff", truncated: false, totalBytes: 11 });
    await act(async () => secondRun);
    first.resolve({ content: "stale first diff", truncated: false, totalBytes: 16 });
    await act(async () => firstRun);

    expect(cancelGitQuery).toHaveBeenCalledWith(getGitStashDiff.mock.calls[0][0].requestId);
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
    expect(onOpenDiff).toHaveBeenCalledWith("second diff");
    expect(result.current.selectedReference).toBe("stash@{1}");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
