import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGitHistoryController } from "@/components/layout/use-git-history-controller";
import type { GitCommitDetails, GitCommitSummary } from "@/features/git/git-history-model";
import type { GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

const commit: GitCommitSummary = {
  commit: "abcdef1234567890",
  shortCommit: "abcdef1",
  parents: ["parent"],
  refs: ["main"],
  subject: "Update files",
  author: "ArkLine",
  authorEmail: "arkline@example.invalid",
  authoredAtEpochSeconds: 1_785_283_200,
  graph: "*",
};

const details: GitCommitDetails = {
  commit: commit.commit,
  shortCommit: commit.shortCommit,
  parents: commit.parents,
  author: commit.author,
  authorEmail: commit.authorEmail,
  authoredAtEpochSeconds: commit.authoredAtEpochSeconds,
  subject: commit.subject,
  body: "",
  files: [
    { status: "M", path: "src/first.ets", previousPath: null },
    { status: "R100", path: "src/second.ets", previousPath: "src/old.ets" },
  ],
  filesTruncated: false,
};

describe("useGitHistoryController", () => {
  it("cancels an obsolete commit-file preview and ignores its late result", async () => {
    const first = deferred<{ content: string; truncated: boolean; totalBytes: number }>();
    const second = deferred<{ content: string; truncated: boolean; totalBytes: number }>();
    const getGitCommitFileDiff = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const cancelGitQuery = vi.fn().mockResolvedValue(true);
    const onOpenDiff = vi.fn();
    const workspaceApi = {
      getGitCommitDetails: vi.fn().mockResolvedValue(details),
      getGitCommitFileDiff,
      cancelGitQuery,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitHistoryController({
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff,
      onApplySnapshot: vi.fn(),
      onStatusChange: vi.fn(),
    }));

    await act(async () => result.current.selectCommit(commit));
    await waitFor(() => expect(result.current.details).toEqual(details));

    let firstRun: Promise<void> | undefined;
    act(() => { firstRun = result.current.openCommitFileDiff(details.files[0]); });
    await waitFor(() => expect(result.current.diffLoading).toBe(true));
    let secondRun: Promise<void> | undefined;
    act(() => { secondRun = result.current.openCommitFileDiff(details.files[1]); });

    second.resolve({ content: "second file diff", truncated: false, totalBytes: 16 });
    await act(async () => { await secondRun; });
    first.resolve({ content: "stale first diff", truncated: false, totalBytes: 16 });
    await act(async () => { await firstRun; });

    expect(cancelGitQuery).toHaveBeenCalledWith(getGitCommitFileDiff.mock.calls[0][0].requestId);
    expect(getGitCommitFileDiff.mock.calls[1][0]).toEqual(expect.objectContaining({
      relativePath: "src/second.ets",
      previousPath: "src/old.ets",
    }));
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
    expect(onOpenDiff).toHaveBeenCalledWith("second file diff");
    expect(result.current.selectedFilePath).toBe("src/second.ets");
  });

  it("confirms a history action and applies its repository snapshot", async () => {
    const snapshot = repositorySnapshot("cherryPick", 1);
    const runGitHistoryAction = vi.fn().mockResolvedValue({ message: "Cherry-pick paused", snapshot });
    const onApplySnapshot = vi.fn();
    const onStatusChange = vi.fn();
    const reconcileDocuments = vi.fn().mockResolvedValue({ updatedPaths: [], deletedPaths: [], conflictPaths: [], failedPaths: [] });
    const workspaceApi = {
      getGitCommitDetails: vi.fn().mockResolvedValue(details),
      runGitHistoryAction,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitHistoryController({
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onApplySnapshot,
      onStatusChange,
      reconcileDocuments,
    }));

    await act(async () => result.current.selectCommit(commit));
    act(() => result.current.requestCommitAction("cherryPick"));
    expect(result.current.pendingAction).toBe("cherryPick");
    await act(async () => result.current.confirmCommitAction());

    expect(runGitHistoryAction).toHaveBeenCalledWith({ rootPath: "/workspace", commit: commit.commit, action: "cherryPick" });
    expect(onApplySnapshot).toHaveBeenCalledWith(snapshot);
    expect(reconcileDocuments).toHaveBeenCalledWith(null);
    expect(onStatusChange).toHaveBeenCalledWith("Cherry-pick paused. Resolve conflicts in Changes.");
  });

  it("keeps a history action pending when unsaved documents block it", async () => {
    const runGitHistoryAction = vi.fn();
    const ensureWorkingTreeReady = vi.fn().mockResolvedValue(false);
    const workspaceApi = {
      getGitCommitDetails: vi.fn().mockResolvedValue(details),
      runGitHistoryAction,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitHistoryController({
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onApplySnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      ensureWorkingTreeReady,
    }));

    await act(async () => result.current.selectCommit(commit));
    act(() => result.current.requestCommitAction("revert"));
    await act(async () => result.current.confirmCommitAction());

    expect(ensureWorkingTreeReady).toHaveBeenCalledWith({ actionLabel: "Revert commit", paths: null });
    expect(runGitHistoryAction).not.toHaveBeenCalled();
    expect(result.current.pendingAction).toBe("revert");
  });
});

function repositorySnapshot(operation: "idle" | "cherryPick", conflictedChanges: number): GitRepositorySnapshot {
  return {
    rootPath: "/workspace", repositoryRoot: "/workspace", currentBranch: "main", detached: false,
    upstream: null, ahead: 0, behind: 0, operation, generation: 3, snapshotId: "snapshot-3",
    totalChanges: conflictedChanges, stagedChanges: 0, conflictedChanges, nextCursor: null,
    hasMore: false, changes: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
