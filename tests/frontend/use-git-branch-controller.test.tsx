import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGitBranchController } from "@/components/layout/use-git-branch-controller";
import type { GitBranchSnapshot } from "@/features/git/git-branch-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

const snapshot: GitBranchSnapshot = {
  rootPath: "/workspace",
  currentBranch: "main",
  detached: false,
  localBranches: [{
    name: "main",
    displayName: "main",
    kind: "local",
    current: true,
    favorite: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
  }],
  remoteBranches: [],
  recentBranches: ["main"],
  workingTree: { dirty: false, changedFiles: 0, conflictedFiles: 0 },
};

describe("useGitBranchController", () => {
  it("opens immediately from the repository snapshot already loaded for the status bar", async () => {
    let branchQueries = 0;
    const workspaceApi = {
      listGitBranches: async () => {
        branchQueries += 1;
        return snapshot;
      },
    } as unknown as WorkspaceApi;
    const { result } = renderHook(() => useGitBranchController({
      workspaceApi,
      workspaceRootPath: "/workspace",
      hasDirtyDocuments: () => false,
      onRefreshWorkspace: async () => undefined,
      onStatusChange: () => undefined,
    }));

    await waitFor(() => expect(result.current.currentBranch).toBe("main"));
    expect(branchQueries).toBe(1);

    act(() => result.current.open());

    expect(result.current.visible).toBe(true);
    expect(result.current.items).toHaveLength(1);
    expect(branchQueries).toBe(1);
  });
});
