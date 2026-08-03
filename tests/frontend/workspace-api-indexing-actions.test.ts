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

    await expect(defaultWorkspaceApi.semanticCompleteSymbol?.("C:/samples/DemoWorkspace", request, 42)).resolves.toBe(envelope);

    expect(invoke).toHaveBeenCalledWith("semantic_complete_symbol", {
      rootPath: "C:/samples/DemoWorkspace",
      request,
      requestGeneration: 42,
    });
  });

  it("invokes the unified language definition broker", async () => {
    const envelope = brokerEnvelope([
      { path: "C:/samples/DemoWorkspace/src/B.ets", line: 4, column: 2, preview: "class B" },
    ]);
    invoke.mockResolvedValueOnce(envelope);
    const request = languageRequest();

    await expect(defaultWorkspaceApi.queryLanguageDefinition?.(
      "C:/samples/DemoWorkspace",
      request,
      42,
    )).resolves.toBe(envelope);

    expect(invoke).toHaveBeenCalledWith("query_language_definition", {
      rootPath: "C:/samples/DemoWorkspace",
      request,
      requestGeneration: 42,
    });
  });

  it("invokes the unified language completion broker", async () => {
    const envelope = brokerEnvelope([
      { label: "build()", detail: "Index method", kind: "method", source: "type" },
    ]);
    invoke.mockResolvedValueOnce(envelope);
    const request = languageRequest();

    await expect(defaultWorkspaceApi.queryLanguageCompletion?.(
      "C:/samples/DemoWorkspace",
      request,
      43,
      9,
    )).resolves.toBe(envelope);

    expect(invoke).toHaveBeenCalledWith("query_language_completion", {
      rootPath: "C:/samples/DemoWorkspace",
      request,
      requestGeneration: 43,
      documentVersion: 9,
    });
  });

  it("schedules semantic document preparation through the desktop host", async () => {
    const request = {
      path: "C:/samples/DemoWorkspace/src/main.ets",
      documentVersion: 9,
    };

    await defaultWorkspaceApi.prepareSemanticDocument?.(request);

    expect(invoke).toHaveBeenCalledWith("prepare_language_document", { request });
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

function languageRequest() {
  return {
    path: "C:/samples/DemoWorkspace/src/main.ets",
    line: 1,
    column: 4,
    content: "pri",
  };
}

function brokerEnvelope<T>(items: T[]) {
  return {
    items,
    readiness: {
      rootPath: "C:/samples/DemoWorkspace",
      requestedGeneration: 1,
      servedGeneration: 1,
      state: "ready",
      retryable: false,
    },
    requestGeneration: 42,
    documentGeneration: null,
    targetGeneration: 1,
    provider: "languageBroker",
    confidence: "semantic",
    fallbackUsed: false,
    missReason: null,
    explain: [],
  };
}
