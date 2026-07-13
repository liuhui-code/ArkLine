import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

const invoke = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("workspace api indexing actions", () => {
  beforeEach(() => {
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
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
    await defaultWorkspaceApi.scheduleForegroundCompletionIndex?.("C:/samples/DemoWorkspace", ["C:/samples/DemoWorkspace/src/main.ets"]);

    expect(invoke).toHaveBeenCalledWith("schedule_foreground_completion_index", {
      rootPath: "C:/samples/DemoWorkspace",
      changedPaths: ["C:/samples/DemoWorkspace/src/main.ets"],
    });
  });

  it("schedules foreground navigation indexing in the desktop runtime", async () => {
    await defaultWorkspaceApi.scheduleForegroundNavigationIndex?.("C:/samples/DemoWorkspace", ["C:/samples/DemoWorkspace/src/main.ets"]);

    expect(invoke).toHaveBeenCalledWith("schedule_foreground_navigation_index", {
      rootPath: "C:/samples/DemoWorkspace",
      changedPaths: ["C:/samples/DemoWorkspace/src/main.ets"],
    });
  });

  it("schedules visible files indexing in the desktop runtime", async () => {
    await defaultWorkspaceApi.scheduleVisibleFilesIndex?.("C:/samples/DemoWorkspace", ["C:/samples/DemoWorkspace/src/visible.ets"]);

    expect(invoke).toHaveBeenCalledWith("schedule_visible_files_index", {
      rootPath: "C:/samples/DemoWorkspace",
      changedPaths: ["C:/samples/DemoWorkspace/src/visible.ets"],
    });
  });
});
