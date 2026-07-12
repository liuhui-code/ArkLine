import { describe, expect, it, vi } from "vitest";
import { createWorkspaceSearchInteractionRuntime } from "@/components/layout/search-workspace-runtime";

describe("workspace search interaction runtime", () => {
  it("cancels the previous backend query through the current workspace api", () => {
    const cancelWorkspaceSearch = vi.fn(async () => undefined);
    const runtime = createWorkspaceSearchInteractionRuntime({
      getRootPath: () => "/workspace",
      getWorkspaceApi: () => ({ cancelWorkspaceSearch }),
    });

    runtime.startQuery("searchEverywhere");
    runtime.startQuery("text");

    expect(cancelWorkspaceSearch).toHaveBeenCalledWith("/workspace", "searchEverywhere", 1);
  });

  it("ignores cancellation when no workspace root is available", () => {
    const cancelWorkspaceSearch = vi.fn(async () => undefined);
    const runtime = createWorkspaceSearchInteractionRuntime({
      getRootPath: () => null,
      getWorkspaceApi: () => ({ cancelWorkspaceSearch }),
    });

    runtime.startQuery("searchEverywhere");
    runtime.startQuery("text");

    expect(cancelWorkspaceSearch).not.toHaveBeenCalled();
  });
});
