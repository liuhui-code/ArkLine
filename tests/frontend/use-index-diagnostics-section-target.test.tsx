import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIndexDiagnosticsController } from "@/components/layout/use-index-diagnostics-controller";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

describe("useIndexDiagnosticsController section target", () => {
  it("stores the requested diagnostics section target when opening diagnostics", async () => {
    const { result } = renderHook(() => useIndexDiagnosticsController(options()));

    await act(async () => {
      result.current.openIndexDiagnostics("index-diagnostics-health");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.indexDiagnosticsVisible).toBe(true);
    expect(result.current.indexDiagnosticsSectionTarget).toBe("index-diagnostics-health");
  });
});

function options() {
  return {
    workspaceApi: workspaceApi(),
    workspace: workspace(),
    workspaceIndexState: indexState(),
    activePath: "/workspace/Entry.ets",
    applyWorkspaceIndexRefreshResult: vi.fn(),
    openSettings: vi.fn(async () => undefined),
    retryDefinitionQuery: vi.fn(),
    retrySearchQuery: vi.fn(),
    onStatusChange: vi.fn(),
  };
}

function workspaceApi(): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    loadDiff: vi.fn(),
    inspectEnvironment: vi.fn(),
    saveSettings: vi.fn(),
    loadSettings: vi.fn(),
  } as unknown as WorkspaceApi;
}

function workspace(): WorkspaceViewModel {
  return {
    rootName: "workspace",
    rootPath: "/workspace",
    visibleFiles: ["/workspace/Entry.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 1,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}

function indexState(): WorkspaceIndexState {
  return {
    status: "ready",
    rootPath: "/workspace",
    filePaths: ["/workspace/Entry.ets"],
    symbols: [],
    indexedAt: 1,
    partialReason: null,
    queryReadiness: null,
  };
}
