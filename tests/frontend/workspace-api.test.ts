import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventListeners = vi.hoisted(() => [] as Array<(event: { payload: unknown }) => void>);
const unlisten = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_eventName: string, callback: (event: { payload: unknown }) => void) => {
    eventListeners.push(callback);
    return unlisten;
  }),
}));

describe("workspace api", () => {
  beforeEach(() => {
    eventListeners.length = 0;
    invoke.mockClear();
    unlisten.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("subscribes to workspace index events and forwards only the active root", async () => {
    const onChange = vi.fn();

    const teardown = await defaultWorkspaceApi.watchWorkspaceIndex?.("C:/samples/DemoWorkspace", onChange);

    expect(invoke).toHaveBeenCalledWith("watch_workspace_index", { rootPath: "C:/samples/DemoWorkspace" });
    expect(eventListeners).toHaveLength(1);
    eventListeners[0]?.({
      payload: {
        state: {
          status: "ready",
          rootPath: "C:/samples/OtherWorkspace",
          filePaths: [],
          indexedAt: 1,
          partialReason: null,
        },
        changed: true,
        addedPaths: ["C:/samples/OtherWorkspace/src/Other.ets"],
        removedPaths: [],
      },
    });
    eventListeners[0]?.({
      payload: {
        state: {
          status: "ready",
          rootPath: "C:\\samples\\DemoWorkspace",
          filePaths: ["C:\\samples\\DemoWorkspace\\src\\About.ets"],
          indexedAt: 2,
          partialReason: null,
        },
        changed: true,
        addedPaths: ["C:\\samples\\DemoWorkspace\\src\\About.ets"],
        removedPaths: [],
      },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      addedPaths: ["C:\\samples\\DemoWorkspace\\src\\About.ets"],
    }));

    teardown?.();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("unwatch_workspace_index", { rootPath: "C:/samples/DemoWorkspace" });
  });

  it("returns complete fallback diagnostics outside the desktop runtime", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const diagnostics = await defaultWorkspaceApi.inspectWorkspaceIndex?.("C:/samples/DemoWorkspace");

    expect(diagnostics).toMatchObject({
      stubFileCount: 0,
      stubDeclarationCount: 0,
      dependencyEdgeCount: 0,
      unresolvedImportCount: 0,
      parserErrorCount: 0,
      staleGenerationCount: 0,
      lastExplainStatus: null,
    });
  });

  it("returns fallback index health outside the desktop runtime", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const health = await defaultWorkspaceApi.getWorkspaceIndexHealth?.("C:/samples/DemoWorkspace");

    expect(health).toMatchObject({
      rootPath: "C:/samples/DemoWorkspace",
      status: "stale",
      queuePressure: {
        pendingTaskCount: 0,
        workspacePendingTaskCount: 0,
      },
      repairActions: ["rebuildProjectIndex"],
    });
  });

  it("invokes workspace index health in the desktop runtime", async () => {
    const health = {
      rootPath: "C:/samples/DemoWorkspace",
      status: "healthy",
      fileCount: 1,
      symbolCount: 1,
      referenceCount: 1,
      sdkApiCount: 1,
      unresolvedImportCount: 0,
      parserFailureCount: 0,
      queuePressure: {
        rootPath: "C:/samples/DemoWorkspace",
        pendingTaskCount: 0,
        workspacePendingTaskCount: 0,
        highestPriority: null,
        highestPriorityTaskKind: null,
      },
      repairActions: [],
    };
    invoke.mockResolvedValueOnce(health);

    await expect(defaultWorkspaceApi.getWorkspaceIndexHealth?.("C:/samples/DemoWorkspace")).resolves.toEqual(health);
    expect(invoke).toHaveBeenCalledWith("get_workspace_index_health", { rootPath: "C:/samples/DemoWorkspace" });
  });

  it("invokes resume workspace indexing in the desktop runtime", async () => {
    await defaultWorkspaceApi.resumeWorkspaceIndexing?.("C:/samples/DemoWorkspace");

    expect(invoke).toHaveBeenCalledWith("resume_workspace_indexing", {
      rootPath: "C:/samples/DemoWorkspace",
    });
  });

  it("invokes rebuild workspace sdk index in the desktop runtime", async () => {
    const status = {
      taskId: "1:sdk",
      rootPath: "C:/samples/DemoWorkspace",
      kind: "sdk",
      status: "queued",
      reason: "sdk-apply",
      generation: 1,
      progressCurrent: 0,
      progressTotal: 1,
      startedAt: null,
      finishedAt: null,
      symbolCount: null,
      message: null,
      error: null,
    };
    invoke.mockResolvedValueOnce(status);

    await expect(defaultWorkspaceApi.rebuildWorkspaceSdkIndex?.("C:/samples/DemoWorkspace")).resolves.toEqual(status);

    expect(invoke).toHaveBeenCalledWith("rebuild_workspace_sdk_index", {
      rootPath: "C:/samples/DemoWorkspace",
    });
  });

  it("invokes parser failure inspection in the desktop runtime", async () => {
    const failures = [{ path: "src/Broken.ets", message: "Unclosed block", line: 1, column: 1 }];
    invoke.mockResolvedValueOnce(failures);

    await expect(defaultWorkspaceApi.inspectWorkspaceParserFailures?.("C:/samples/DemoWorkspace", 20)).resolves.toEqual(failures);

    expect(invoke).toHaveBeenCalledWith("inspect_workspace_parser_failures", {
      rootPath: "C:/samples/DemoWorkspace",
      limit: 20,
    });
  });

  it("invokes unresolved import inspection in the desktop runtime", async () => {
    const imports = [{ fromPath: "src/Index.ets", sourceModule: "./Missing", line: 1, column: 8 }];
    invoke.mockResolvedValueOnce(imports);

    await expect(defaultWorkspaceApi.inspectWorkspaceUnresolvedImports?.("C:/samples/DemoWorkspace", 20)).resolves.toEqual(imports);

    expect(invoke).toHaveBeenCalledWith("inspect_workspace_unresolved_imports", {
      rootPath: "C:/samples/DemoWorkspace",
      limit: 20,
    });
  });

  it("invokes workspace semantic completion with readiness in the desktop runtime", async () => {
    const envelope = {
      items: [{ label: "private", detail: "ArkTS keyword", kind: "keyword" }],
      readiness: {
        rootPath: "C:/samples/DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready",
        retryable: false,
      },
    };
    invoke.mockResolvedValueOnce(envelope);
    const request = {
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 1,
      column: 4,
      content: "pri",
    };

    await expect(defaultWorkspaceApi.semanticCompleteSymbol?.("C:/samples/DemoWorkspace", request)).resolves.toBe(envelope);

    expect(invoke).toHaveBeenCalledWith("semantic_complete_symbol", {
      rootPath: "C:/samples/DemoWorkspace",
      request,
    });
  });

  it("returns a missing readiness envelope for semantic completion outside the desktop runtime", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const envelope = await defaultWorkspaceApi.semanticCompleteSymbol?.("C:/samples/DemoWorkspace", {
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 1,
      column: 4,
      content: "pri",
    });

    expect(envelope).toMatchObject({
      items: [],
      readiness: {
        rootPath: "C:/samples/DemoWorkspace",
        state: "missing",
        retryable: true,
      },
    });
  });

  it("schedules foreground completion indexing in the desktop runtime", async () => {
    await defaultWorkspaceApi.scheduleForegroundCompletionIndex?.("C:/samples/DemoWorkspace", [
      "C:/samples/DemoWorkspace/src/main.ets",
    ]);

    expect(invoke).toHaveBeenCalledWith("schedule_foreground_completion_index", {
      rootPath: "C:/samples/DemoWorkspace",
      changedPaths: ["C:/samples/DemoWorkspace/src/main.ets"],
    });
  });

  it("schedules visible files indexing in the desktop runtime", async () => {
    await defaultWorkspaceApi.scheduleVisibleFilesIndex?.("C:/samples/DemoWorkspace", [
      "C:/samples/DemoWorkspace/src/visible.ets",
    ]);

    expect(invoke).toHaveBeenCalledWith("schedule_visible_files_index", {
      rootPath: "C:/samples/DemoWorkspace",
      changedPaths: ["C:/samples/DemoWorkspace/src/visible.ets"],
    });
  });
});
