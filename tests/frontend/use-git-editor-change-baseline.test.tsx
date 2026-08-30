import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGitEditorChangeBaseline } from "@/components/layout/use-git-editor-change-baseline";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("useGitEditorChangeBaseline", () => {
  it("reloads the HEAD baseline when the repository generation changes", async () => {
    let comparisonCalls = 0;
    const cancelledRequests: string[] = [];
    const getGitFileComparison = async () => comparison(comparisonCalls++ === 0 ? "old HEAD" : "new HEAD");
    const cancelGitQuery = async (requestId: string) => { cancelledRequests.push(requestId); return true; };
    const workspaceApi = { getGitFileComparison, cancelGitQuery } as unknown as WorkspaceApi;
    const { result, rerender } = renderHook(
      ({ repositoryGeneration }) => useGitEditorChangeBaseline({
        rootPath: "/workspace",
        activePath: "/workspace/src/main.ets",
        repositoryGeneration,
        workspaceApi,
      }),
      { initialProps: { repositoryGeneration: 1 } },
    );

    await waitFor(() => expect(result.current?.content).toBe("old HEAD"));
    rerender({ repositoryGeneration: 2 });

    await waitFor(() => expect(result.current?.content).toBe("new HEAD"));
    expect(comparisonCalls).toBe(2);
    expect(cancelledRequests.some((requestId) => /^git-editor-head-/u.test(requestId))).toBe(true);
  });

  it("reuses a file baseline when switching tabs within one repository generation", async () => {
    let comparisonCalls = 0;
    const getGitFileComparison = async ({ relativePath }: { relativePath: string }) => {
      comparisonCalls += 1;
      return comparison(`HEAD:${relativePath}`);
    };
    const workspaceApi = { getGitFileComparison } as unknown as WorkspaceApi;
    const { result, rerender } = renderHook(
      ({ activePath }) => useGitEditorChangeBaseline({
        rootPath: "/workspace",
        activePath,
        repositoryGeneration: 7,
        workspaceApi,
      }),
      { initialProps: { activePath: "/workspace/src/a.ets" } },
    );

    await waitFor(() => expect(result.current?.content).toBe("HEAD:src/a.ets"));
    rerender({ activePath: "/workspace/src/b.ets" });
    await waitFor(() => expect(result.current?.content).toBe("HEAD:src/b.ets"));
    rerender({ activePath: "/workspace/src/a.ets" });
    await waitFor(() => expect(result.current?.content).toBe("HEAD:src/a.ets"));

    expect(comparisonCalls).toBe(2);
  });

  it("cancels an obsolete file query and ignores its late result", async () => {
    const first = deferred<ReturnType<typeof comparison>>();
    const second = deferred<ReturnType<typeof comparison>>();
    let comparisonCalls = 0;
    const cancelledRequests: string[] = [];
    const getGitFileComparison = () => comparisonCalls++ === 0 ? first.promise : second.promise;
    const cancelGitQuery = async (requestId: string) => { cancelledRequests.push(requestId); return true; };
    const workspaceApi = { getGitFileComparison, cancelGitQuery } as unknown as WorkspaceApi;
    const { result, rerender } = renderHook(
      ({ activePath }) => useGitEditorChangeBaseline({
        rootPath: "/workspace",
        activePath,
        repositoryGeneration: 9,
        workspaceApi,
      }),
      { initialProps: { activePath: "/workspace/src/a.ets" } },
    );

    await waitFor(() => expect(comparisonCalls).toBe(1));
    rerender({ activePath: "/workspace/src/b.ets" });
    await waitFor(() => expect(comparisonCalls).toBe(2));
    await act(async () => second.resolve(comparison("new file")));
    await waitFor(() => expect(result.current?.content).toBe("new file"));
    await act(async () => first.resolve(comparison("stale file")));

    expect(result.current?.content).toBe("new file");
    expect(cancelledRequests.some((requestId) => /^git-editor-head-/u.test(requestId))).toBe(true);
  });
});

function comparison(before: string) {
  return {
    relativePath: "src/main.ets",
    staged: false,
    before: { exists: true, binary: false, content: before, truncated: false, totalBytes: before.length },
    after: { exists: true, binary: false, content: "working tree", truncated: false, totalBytes: 12 },
    patch: { content: "diff", truncated: false, totalBytes: 4 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
