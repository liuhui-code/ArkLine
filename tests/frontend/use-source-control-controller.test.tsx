import { act, renderHook, waitFor } from "@testing-library/react";
import { useSourceControlController } from "@/components/layout/use-source-control-controller";
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
  generation: 1,
  snapshotId: "snapshot-1",
  totalChanges: 0,
  stagedChanges: 0,
  conflictedChanges: 0,
  nextCursor: null,
  hasMore: false,
  changes: [],
};

describe("useSourceControlController remote operations", () => {
  it("runs one trailing refresh when repository invalidation arrives during an active query", async () => {
    const first = deferred<GitRepositorySnapshot>();
    const getGitRepositorySnapshot = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ...snapshot, generation: 2, snapshotId: "snapshot-2" });
    const workspaceApi = { getGitRepositorySnapshot } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
    }));
    await waitFor(() => expect(getGitRepositorySnapshot).toHaveBeenCalledOnce());

    act(() => result.current.refresh());
    first.resolve(snapshot);

    await waitFor(() => expect(getGitRepositorySnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.snapshot?.generation).toBe(2));
  });

  it("runs fetch in the repository runtime and applies its snapshot", async () => {
    const getGitRepositorySnapshot = vi.fn().mockResolvedValue(snapshot);
    const runGitRemoteOperation = vi.fn().mockResolvedValue({
      message: "Fetched origin",
      snapshot: { ...snapshot, generation: 2, behind: 1 },
    });
    const onStatusChange = vi.fn();
    const workspaceApi = {
      getGitRepositorySnapshot,
      runGitRemoteOperation,
    } as unknown as WorkspaceApi;
    const onOpenDiff = vi.fn();
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff,
      onStatusChange,
    }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    await act(async () => {
      await result.current.fetchRemote();
    });

    expect(runGitRemoteOperation).toHaveBeenCalledOnce();
    expect(runGitRemoteOperation).toHaveBeenCalledWith({
      rootPath: "/workspace",
      operation: "fetch",
      remote: null,
      branch: "main",
      timeoutMs: 120_000,
    });
    expect(onStatusChange).toHaveBeenCalledWith("Fetched origin");
    await waitFor(() => expect(result.current.snapshot?.generation).toBe(2));
    expect(result.current.snapshot?.behind).toBe(1);
    expect(result.current.operation).toBe("idle");
  });

  it("keeps remote failures in the Source Control surface", async () => {
    const runGitRemoteOperation = vi.fn().mockRejectedValue(new Error("Git authentication failed"));
    const reconcileDocuments = vi.fn().mockResolvedValue({ updatedPaths: [], deletedPaths: [], conflictPaths: [], failedPaths: [] });
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(snapshot),
      runGitRemoteOperation,
    } as unknown as WorkspaceApi;
    const onOpenDiff = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff,
      onStatusChange,
      reconcileDocuments,
    }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    await act(async () => {
      await result.current.pullRemote();
    });

    await waitFor(() => expect(result.current.error).toBe("Git authentication failed"));
    expect(reconcileDocuments).toHaveBeenCalledWith(null);
    expect(result.current.operation).toBe("idle");
  });

  it("reconciles all open documents after pulling working-tree changes", async () => {
    const runGitRemoteOperation = vi.fn().mockResolvedValue({ message: "Pulled origin", snapshot: { ...snapshot, generation: 2 } });
    const reconcileDocuments = vi.fn().mockResolvedValue({
      updatedPaths: ["/workspace/main.ets"], deletedPaths: [], conflictPaths: [], failedPaths: [],
    });
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(snapshot),
      runGitRemoteOperation,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
      reconcileDocuments,
    }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    await act(async () => result.current.pullRemote());

    expect(reconcileDocuments).toHaveBeenCalledWith(null);
    expect(runGitRemoteOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: "pull" }));
  });

  it("commits with controlled options and hands Commit and Push to the preview workflow", async () => {
    const staged = { ...snapshot, totalChanges: 1, stagedChanges: 1, changes: [{ ...change("tracked.ets"), statusCode: "M.", staged: true, unstaged: false }] };
    const committed = { ...snapshot, generation: 2, snapshotId: "snapshot-2", ahead: 1 };
    const commitGitChanges = vi.fn().mockResolvedValue({ message: "Commit created", snapshot: committed });
    const runGitRemoteOperation = vi.fn();
    const onCommitComplete = vi.fn();
    const onStatusChange = vi.fn();
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(staged),
      commitGitChanges,
      runGitRemoteOperation,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange,
      onCommitComplete,
    }));
    await waitFor(() => expect(result.current.snapshot?.stagedChanges).toBe(1));

    act(() => result.current.setCommitMessage("Improve Git workflow"));
    await waitFor(() => expect(result.current.commitDraft.message).toBe("Improve Git workflow"));
    act(() => {
      void result.current.setCommitAmend(true);
      result.current.setCommitSignOff(true);
    });
    await act(async () => result.current.commit("commitAndPush"));

    expect(commitGitChanges).toHaveBeenCalledWith({
      rootPath: "/workspace",
      message: "Improve Git workflow",
      amend: true,
      signOff: true,
    });
    expect(runGitRemoteOperation).not.toHaveBeenCalled();
    expect(onCommitComplete).toHaveBeenCalledWith("commitAndPush", committed);
    expect(onStatusChange).toHaveBeenLastCalledWith("Commit created");
    expect(result.current.commitDraft.message).toBe("");
  });

  it("clears the draft before opening the independent Push Commits preview", async () => {
    const staged = { ...snapshot, stagedChanges: 1 };
    const commitGitChanges = vi.fn().mockResolvedValue({ message: "Commit created", snapshot: { ...snapshot, ahead: 1 } });
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(staged),
      commitGitChanges,
      runGitRemoteOperation: vi.fn().mockRejectedValue(new Error("Authentication failed")),
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
    }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    act(() => result.current.setCommitMessage("Create commit"));
    await waitFor(() => expect(result.current.commitDraft.message).toBe("Create commit"));

    await act(async () => result.current.commit("commitAndPush"));

    expect(result.current.error).toBeNull();
    expect(workspaceApi.runGitRemoteOperation).not.toHaveBeenCalled();
    expect(result.current.commitDraft.message).toBe("");
  });

  it("appends a stable working-tree page and reports the loaded count", async () => {
    const first = {
      ...snapshot,
      totalChanges: 2,
      nextCursor: "1",
      hasMore: true,
      changes: [change("first.ets")],
    };
    const second = {
      ...snapshot,
      generation: 2,
      totalChanges: 2,
      changes: [change("second.ets")],
    };
    const getGitRepositorySnapshot = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const workspaceApi = { getGitRepositorySnapshot } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
    }));
    await waitFor(() => expect(result.current.snapshot?.changes).toHaveLength(1));

    await act(async () => result.current.loadMoreChanges());

    await waitFor(() => expect(result.current.snapshot?.changes).toHaveLength(2));
    expect(getGitRepositorySnapshot.mock.calls[1][0]).toEqual(expect.objectContaining({ cursor: "1", limit: 200 }));
  });

  it("cancels an obsolete status query when the workspace changes", async () => {
    const pending = new Promise<GitRepositorySnapshot>(() => undefined);
    const cancelGitQuery = vi.fn().mockResolvedValue(true);
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockReturnValue(pending),
      cancelGitQuery,
    } as unknown as WorkspaceApi;
    const { rerender } = renderHook(({ rootPath }) => useSourceControlController({
      active: false,
      rootPath,
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
    }), { initialProps: { rootPath: "/workspace-a" } });

    rerender({ rootPath: "/workspace-b" });

    await waitFor(() => expect(cancelGitQuery).toHaveBeenCalled());
    expect(cancelGitQuery).toHaveBeenCalledWith(expect.stringMatching(/^git-status-/));
  });

  it("keeps a discard backup available until undo restores it", async () => {
    const modified = change("tracked.ets");
    const initial = { ...snapshot, totalChanges: 1, changes: [modified] };
    const discarded = { ...snapshot, generation: 2, snapshotId: "snapshot-2" };
    const restored = { ...initial, generation: 3, snapshotId: "snapshot-3" };
    const discardGitPaths = vi.fn().mockResolvedValue({
      message: "Discarded 1 path(s)",
      backupCommit: "0123456789012345678901234567890123456789",
      snapshot: discarded,
    });
    const restoreGitDiscard = vi.fn().mockResolvedValue({ message: "Restored", snapshot: restored });
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(initial),
      discardGitPaths,
      restoreGitDiscard,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
    }));
    await waitFor(() => expect(result.current.snapshot?.totalChanges).toBe(1));

    act(() => result.current.discard.request(modified));
    await act(async () => result.current.discard.confirm());
    expect(discardGitPaths).toHaveBeenCalledWith({ rootPath: "/workspace", paths: ["tracked.ets"] });
    expect(result.current.discard.backup?.path).toBe("tracked.ets");

    await act(async () => result.current.discard.restore());
    expect(restoreGitDiscard).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "/workspace" }));
    expect(result.current.discard.backup).toBeNull();
  });

  it("pauses a targeted discard until the dirty editor buffer is saved", async () => {
    const modified = change("tracked.ets");
    const initial = { ...snapshot, totalChanges: 1, changes: [modified] };
    const discardGitPaths = vi.fn().mockResolvedValue({
      message: "Discarded",
      backupCommit: "0123456789012345678901234567890123456789",
      snapshot: { ...snapshot, generation: 2 },
    });
    const saveDirtyDocuments = vi.fn().mockResolvedValue(undefined);
    const reconcileDocuments = vi.fn().mockResolvedValue({ updatedPaths: ["/workspace/tracked.ets"], deletedPaths: [], conflictPaths: [], failedPaths: [] });
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(initial),
      discardGitPaths,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
      getDirtyDocumentPaths: () => ["/workspace/tracked.ets", "/workspace/other.ets"],
      saveDirtyDocuments,
      reconcileDocuments,
    }));
    await waitFor(() => expect(result.current.snapshot?.totalChanges).toBe(1));

    act(() => result.current.discard.request(modified));
    let discardRun!: Promise<void>;
    act(() => { discardRun = result.current.discard.confirm(); });
    await waitFor(() => expect(result.current.dirtyGuard.pending?.dirtyPaths).toEqual(["/workspace/tracked.ets"]));
    expect(discardGitPaths).not.toHaveBeenCalled();

    await act(async () => result.current.dirtyGuard.saveAndContinue());
    await act(async () => discardRun);
    expect(saveDirtyDocuments).toHaveBeenCalledWith(["/workspace/tracked.ets"]);
    expect(discardGitPaths).toHaveBeenCalledWith({ rootPath: "/workspace", paths: ["tracked.ets"] });
    expect(reconcileDocuments).toHaveBeenCalledWith(["tracked.ets"]);
  });

  it("does not guard staging because it cannot overwrite editor buffers", async () => {
    const modified = change("tracked.ets");
    const initial = { ...snapshot, totalChanges: 1, changes: [modified] };
    const stageGitPaths = vi.fn().mockResolvedValue({ message: "Staged", snapshot: initial });
    const getDirtyDocumentPaths = vi.fn(() => ["/workspace/tracked.ets"]);
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(initial),
      stageGitPaths,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff: vi.fn(),
      onStatusChange: vi.fn(),
      getDirtyDocumentPaths,
      saveDirtyDocuments: vi.fn(),
    }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());

    act(() => result.current.stage(modified));
    await waitFor(() => expect(stageGitPaths).toHaveBeenCalledOnce());
    expect(result.current.dirtyGuard.pending).toBeNull();
  });

  it("applies and restores a partial discard without using whole-file restore", async () => {
    const modified = change("tracked.ets");
    const initial = { ...snapshot, totalChanges: 1, changes: [modified] };
    const patched = { ...initial, generation: 2, snapshotId: "snapshot-2" };
    const restored = { ...initial, generation: 3, snapshotId: "snapshot-3" };
    const applyGitPartialPatch = vi.fn().mockResolvedValue({
      message: "Discarded selected changes",
      backupCommit: "0123456789012345678901234567890123456789",
      snapshot: patched,
    });
    const restoreGitPartialPatch = vi.fn().mockResolvedValue({ message: "Restored selection", snapshot: restored });
    const restoreGitDiscard = vi.fn();
    const getGitFileDiff = vi.fn().mockResolvedValue({ content: "remaining diff", truncated: false, totalBytes: 14 });
    const onOpenDiff = vi.fn();
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(initial),
      getGitFileDiff,
      applyGitPartialPatch,
      restoreGitPartialPatch,
      restoreGitDiscard,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff,
      onStatusChange: vi.fn(),
    }));
    await waitFor(() => expect(result.current.snapshot?.totalChanges).toBe(1));
    const context = { relativePath: "tracked.ets", staged: false, kind: "modified" as const };

    await act(async () => result.current.applyPartialPatch("discard", "@@ -1,1 +1,0 @@\n-old\n", context));
    expect(applyGitPartialPatch).toHaveBeenCalledWith(expect.objectContaining({ action: "discard", patch: "@@ -1,1 +1,0 @@\n-old\n" }));
    expect(onOpenDiff).toHaveBeenCalledWith("remaining diff", context, null);
    expect(result.current.discard.backup).toMatchObject({ path: "tracked.ets", patch: "@@ -1,1 +1,0 @@\n-old\n" });

    await act(async () => result.current.discard.restore());
    expect(restoreGitPartialPatch).toHaveBeenCalledWith(expect.objectContaining({ relativePath: "tracked.ets" }));
    expect(restoreGitDiscard).not.toHaveBeenCalled();
  });

  it("opens a bounded full-file comparison when the runtime supports it", async () => {
    const modified = change("tracked.ets");
    const initial = { ...snapshot, totalChanges: 1, changes: [modified] };
    const comparison = {
      relativePath: "tracked.ets",
      staged: false,
      before: { exists: true, binary: false, content: "before\n", truncated: false, totalBytes: 7 },
      after: { exists: true, binary: false, content: "after\n", truncated: false, totalBytes: 6 },
      patch: { content: "patch", truncated: false, totalBytes: 5 },
    };
    const getGitFileComparison = vi.fn().mockResolvedValue(comparison);
    const onOpenDiff = vi.fn();
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(initial),
      getGitFileComparison,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff,
      onStatusChange: vi.fn(),
    }));
    await waitFor(() => expect(result.current.snapshot?.totalChanges).toBe(1));

    await act(async () => result.current.openDiff({ entry: modified, staged: false }));

    expect(getGitFileComparison).toHaveBeenCalledWith(expect.objectContaining({
      relativePath: "tracked.ets",
      originalPath: null,
      staged: false,
    }));
    expect(onOpenDiff).toHaveBeenCalledWith(
      "patch",
      { relativePath: "tracked.ets", staged: false, kind: "modified" },
      comparison,
    );
  });

  it("falls back to the patch when full-file comparison is unavailable", async () => {
    const modified = change("tracked.ets");
    const initial = { ...snapshot, totalChanges: 1, changes: [modified] };
    const getGitFileComparison = vi.fn().mockRejectedValue(new Error("Git comparison path is not a file: tracked.ets"));
    const getGitFileDiff = vi.fn().mockResolvedValue({ content: "patch", truncated: false, totalBytes: 5 });
    const onOpenDiff = vi.fn();
    const workspaceApi = {
      getGitRepositorySnapshot: vi.fn().mockResolvedValue(initial),
      getGitFileComparison,
      getGitFileDiff,
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useSourceControlController({
      active: false,
      rootPath: "/workspace",
      workspaceApi,
      onOpenDiff,
      onStatusChange: vi.fn(),
    }));
    await waitFor(() => expect(result.current.snapshot?.totalChanges).toBe(1));

    await act(async () => result.current.openDiff({ entry: modified, staged: false }));

    expect(getGitFileDiff).toHaveBeenCalledOnce();
    expect(onOpenDiff).toHaveBeenCalledWith(
      "patch",
      { relativePath: "tracked.ets", staged: false, kind: "modified" },
      null,
    );
    expect(result.current.error).toBeNull();
  });
});

function change(relativePath: string) {
  return {
    relativePath,
    absolutePath: `/workspace/${relativePath}`,
    originalPath: null,
    statusCode: ".M",
    kind: "modified" as const,
    staged: false,
    unstaged: true,
    conflicted: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
