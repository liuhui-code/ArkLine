import { describe, expect, it, vi } from "vitest";
import { createWorkspaceIndexQueryApi } from "@/features/workspace/workspace-index-query-api";

describe("workspace index query api", () => {
  it("passes search ranking context to indexed candidate readiness queries", async () => {
    const envelope = {
      items: [],
      readiness: {
        rootPath: "C:/samples/DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready",
        retryable: false,
      },
      nextCursor: null,
    };
    const context = {
      activePath: "C:/samples/DemoWorkspace/src/Entry.ets",
      recentPaths: ["C:/samples/DemoWorkspace/src/Recent.ets"],
    };
    const invokeSpy = vi.fn();
    const invoke = <T,>(command: string, args?: Record<string, unknown>) => {
      invokeSpy(command, args);
      return Promise.resolve(envelope as T);
    };
    const api = createWorkspaceIndexQueryApi({
      invoke,
      hasTauriRuntime: () => true,
    });

    await expect(api.queryWorkspaceCandidatesWithReadiness(
      "C:/samples/DemoWorkspace",
      "Entry",
      "all",
      26,
      null,
      context,
    )).resolves.toBe(envelope);

    expect(invokeSpy).toHaveBeenCalledWith("query_workspace_candidates_with_readiness", {
      rootPath: "C:/samples/DemoWorkspace",
      query: "Entry",
      scope: "all",
      limit: 26,
      cursor: null,
      context,
    });
  });
});
