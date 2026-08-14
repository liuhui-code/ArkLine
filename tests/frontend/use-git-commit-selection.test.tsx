import { act, renderHook } from "@testing-library/react";
import { useGitCommitSelection } from "@/components/layout/use-git-commit-selection";
import type { GitChangeEntry, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("Git commit selection", () => {
  it("stages the full contents of an included partially-staged file", async () => {
    const stageGitPaths = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useGitCommitSelection({ rootPath: "/repo", snapshot: snapshot([entry("src/main.ets", { staged: true, unstaged: true })]), workspaceApi: { stageGitPaths } as WorkspaceApi }));
    await act(() => result.current.prepare());
    expect(stageGitPaths).toHaveBeenCalledWith({ rootPath: "/repo", paths: ["src/main.ets"] });
  });

  it("excludes unversioned files until the user checks them", async () => {
    const file = entry("notes.txt", { kind: "untracked", unstaged: true });
    const stageGitPaths = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useGitCommitSelection({ rootPath: "/repo", snapshot: snapshot([file]), workspaceApi: { stageGitPaths } as WorkspaceApi }));
    expect(result.current.includedCount).toBe(0);
    act(() => result.current.toggle(file));
    await act(() => result.current.prepare());
    expect(stageGitPaths).toHaveBeenCalledWith({ rootPath: "/repo", paths: ["notes.txt"] });
  });

  it("unstages a tracked file excluded from the commit", async () => {
    const first = entry("src/a.ets", { staged: true });
    const second = entry("src/b.ets", { staged: true });
    const unstageGitPaths = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useGitCommitSelection({ rootPath: "/repo", snapshot: snapshot([first, second]), workspaceApi: { unstageGitPaths } as WorkspaceApi }));
    act(() => result.current.toggle(second));
    await act(() => result.current.prepare());
    expect(unstageGitPaths).toHaveBeenCalledWith({ rootPath: "/repo", paths: ["src/b.ets"] });
  });
});

function entry(relativePath: string, values: Partial<GitChangeEntry>): GitChangeEntry {
  return { absolutePath: `/repo/${relativePath}`, relativePath, originalPath: null, statusCode: ".M", kind: "modified", staged: false, unstaged: false, conflicted: false, ...values };
}

function snapshot(changes: GitChangeEntry[]): GitRepositorySnapshot {
  return { rootPath: "/repo", repositoryRoot: "/repo", currentBranch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, operation: "idle", generation: 1, snapshotId: "one", totalChanges: changes.length, stagedChanges: changes.filter((item) => item.staged).length, conflictedChanges: 0, nextCursor: null, hasMore: false, changes };
}
