import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { selectAffectedDirtyPaths, useGitWorkingTreeGuard } from "@/components/layout/use-git-working-tree-guard";

describe("Git working tree guard", () => {
  it("selects only dirty workspace files affected by a path-scoped operation", () => {
    expect(selectAffectedDirtyPaths("/work/project", [
      "/work/project/src/main.ets",
      "/work/project/src/other.ets",
      "/work/project-copy/src/main.ets",
    ], ["src/main.ets"])).toEqual(["/work/project/src/main.ets"]);
  });

  it("normalizes Windows paths and limits repository-wide operations to the workspace", () => {
    expect(selectAffectedDirtyPaths("C:\\Work\\Project", [
      "c:/work/project/src/Main.ets",
      "C:\\Work\\Elsewhere\\Other.ets",
    ], null)).toEqual(["c:/work/project/src/Main.ets"]);
  });

  it("pauses until dirty files are saved and then resumes the caller", async () => {
    const saveDirtyDocuments = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useGitWorkingTreeGuard({
      rootPath: "/workspace",
      getDirtyDocumentPaths: () => ["/workspace/src/main.ets"],
      saveDirtyDocuments,
    }));
    let readiness!: Promise<boolean>;

    act(() => { readiness = result.current.ensureReady({ actionLabel: "Pull remote changes", paths: null }); });
    await waitFor(() => expect(result.current.pending?.actionLabel).toBe("Pull remote changes"));
    expect(saveDirtyDocuments).not.toHaveBeenCalled();

    await act(async () => result.current.saveAndContinue());
    await expect(readiness).resolves.toBe(true);
    expect(saveDirtyDocuments).toHaveBeenCalledWith(["/workspace/src/main.ets"]);
    expect(result.current.pending).toBeNull();
  });

  it("keeps the operation paused when save fails and permits cancellation", async () => {
    const saveDirtyDocuments = vi.fn().mockRejectedValue(new Error("Disk is read-only"));
    const { result } = renderHook(() => useGitWorkingTreeGuard({
      rootPath: "/workspace",
      getDirtyDocumentPaths: () => ["/workspace/src/main.ets"],
      saveDirtyDocuments,
    }));
    let readiness!: Promise<boolean>;

    act(() => { readiness = result.current.ensureReady({ actionLabel: "Apply stash", paths: null }); });
    await act(async () => result.current.saveAndContinue());
    expect(result.current.error).toBe("Disk is read-only");
    expect(result.current.pending).not.toBeNull();

    act(() => result.current.cancel());
    await expect(readiness).resolves.toBe(false);
  });

  it("cancels a pending operation when the workspace changes", async () => {
    const { result, rerender } = renderHook(({ rootPath }) => useGitWorkingTreeGuard({
      rootPath,
      getDirtyDocumentPaths: () => [`${rootPath}/main.ets`],
      saveDirtyDocuments: vi.fn(),
    }), { initialProps: { rootPath: "/workspace-a" } });
    let readiness!: Promise<boolean>;

    act(() => { readiness = result.current.ensureReady({ actionLabel: "Revert commit", paths: null }); });
    rerender({ rootPath: "/workspace-b" });

    await expect(readiness).resolves.toBe(false);
    expect(result.current.pending).toBeNull();
  });
});
