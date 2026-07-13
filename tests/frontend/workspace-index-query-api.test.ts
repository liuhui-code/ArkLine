import { describe, expect, it, vi } from "vitest";
import { createWorkspaceIndexQueryApi } from "@/features/workspace/workspace-index-query-api";

describe("workspace index query api", () => {
  it("does not expose legacy non-envelope indexed search fields", () => {
    const api = createWorkspaceIndexQueryApi({
      invoke: vi.fn(),
      hasTauriRuntime: () => false,
    }) as Record<string, unknown>;

    expect(api.queryWorkspaceSearchEverywhere).toBeUndefined();
    expect(api.queryWorkspaceCandidates).toBeUndefined();
    expect(api.queryWorkspaceFileSymbols).toBeUndefined();
  });

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
      openedPaths: ["C:/samples/DemoWorkspace/src/Opened.ets"],
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

  it("routes indexed search surfaces only through readiness commands", async () => {
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
    const invokedCommands: string[] = [];
    const api = createWorkspaceIndexQueryApi({
      invoke: <T,>(command: string) => {
        invokedCommands.push(command);
        return Promise.resolve(envelope as T);
      },
      hasTauriRuntime: () => true,
    });

    await api.queryWorkspaceCandidatesWithReadiness("C:/samples/DemoWorkspace", "Entry", "all", 20);
    await api.queryWorkspaceFileSymbolsWithReadiness(
      "C:/samples/DemoWorkspace",
      "C:/samples/DemoWorkspace/src/Entry.ets",
      "about",
      20,
    );

    expect(invokedCommands).toEqual([
      "query_workspace_candidates_with_readiness",
      "query_workspace_file_symbols_with_readiness",
    ]);
    expect(invokedCommands).not.toContain("query_workspace_candidates");
    expect(invokedCommands).not.toContain("query_workspace_file_symbols");
    expect(invokedCommands).not.toContain("query_workspace_search_everywhere");
  });

  it("routes rename impact queries through the symbol-identity command", async () => {
    const impact = {
      symbolId: "project:Foo",
      currentName: "Foo",
      declaration: null,
      references: [],
    };
    const invokeSpy = vi.fn();
    const api = createWorkspaceIndexQueryApi({
      invoke: <T,>(command: string, args?: Record<string, unknown>) => {
        invokeSpy(command, args);
        return Promise.resolve(impact as T);
      },
      hasTauriRuntime: () => true,
    });
    const request = {
      path: "/workspace/Foo.ets",
      line: 1,
      column: 14,
      content: "export class Foo {}",
    };

    await expect(api.queryRenameImpact("/workspace", request)).resolves.toBe(impact);

    expect(invokeSpy).toHaveBeenCalledWith("query_rename_impact", {
      rootPath: "/workspace",
      request,
    });
  });

  it("routes hierarchy queries through indexed symbol commands", async () => {
    const invokeSpy = vi.fn();
    const api = createWorkspaceIndexQueryApi({
      invoke: <T,>(command: string, args?: Record<string, unknown>) => {
        invokeSpy(command, args);
        return Promise.resolve(null as T);
      },
      hasTauriRuntime: () => true,
    });
    const request = {
      path: "/workspace/Service.ets",
      line: 2,
      column: 17,
      content: "export function load() {}",
    };

    await api.queryCallHierarchy("/workspace", request);
    await api.queryTypeHierarchy("/workspace", request);

    expect(invokeSpy).toHaveBeenCalledWith("query_call_hierarchy", {
      rootPath: "/workspace",
      request,
    });
    expect(invokeSpy).toHaveBeenCalledWith("query_type_hierarchy", {
      rootPath: "/workspace",
      request,
    });
  });
});
