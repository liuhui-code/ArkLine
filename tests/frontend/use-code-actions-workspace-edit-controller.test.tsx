import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCodeActionsWorkspaceEditController } from "@/components/layout/use-code-actions-workspace-edit-controller";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";

describe("useCodeActionsWorkspaceEditController", () => {
  afterEach(() => {
    languageQuerySnapshotStore.clear();
  });

  it("records language query snapshot metadata when listing code actions", async () => {
    const listCodeActions = vi.fn(async () => []);
    const { result } = renderHook(() => useCodeActionsWorkspaceEditController(options({
      workspaceApi: workspaceApi({ listCodeActions }),
    })));

    await act(async () => {
      await result.current.showCodeActionsFromEditor();
    });

    expect(listCodeActions).toHaveBeenCalledWith({
      path: "/workspace/A.ets",
      line: 4,
      column: 2,
      content: "class A {}",
    });
    expect(languageQuerySnapshotStore.snapshot()[0]).toMatchObject({
      kind: "codeActions",
      path: "/workspace/A.ets",
      contentClass: "normal",
    });
  });
});

function options(overrides: Partial<Parameters<typeof useCodeActionsWorkspaceEditController>[0]> = {}) {
  return {
    workspace: workspace(),
    workspaceApi: workspaceApi({}),
    activePath: "/workspace/A.ets",
    editorSelection: { line: 4, column: 2 },
    settingsApplying: false,
    getActiveContent: () => "class A {}",
    documentsRef: { current: { getDocument: vi.fn(), openDocument: vi.fn(), applyExternalChange: vi.fn() } },
    tabsRef: { current: { state: { openTabs: [], recentFiles: [], activePath: null } } },
    setWorkspace: vi.fn(),
    syncTabs: vi.fn(),
    syncWorkspaceIndex: vi.fn(),
    setActiveDocument: vi.fn(),
    clearCompletionSession: vi.fn(),
    resetCompletionAnchor: vi.fn(),
    closeOverlay: vi.fn(),
    hideCurrentClassMethods: vi.fn(),
    focusEditorSoon: vi.fn(),
    onStatusChange: vi.fn(),
    ...overrides,
  };
}

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
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
    ...overrides,
  } as unknown as WorkspaceApi;
}

function workspace(): WorkspaceViewModel {
  return {
    rootName: "workspace",
    rootPath: "/workspace",
    visibleFiles: ["/workspace/A.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 1,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}
