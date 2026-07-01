import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventListeners = vi.hoisted(() => [] as Array<(event: { payload: unknown }) => void>);
const unlisten = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn(async () => undefined));

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
});
