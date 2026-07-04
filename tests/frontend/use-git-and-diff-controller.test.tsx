import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGitAndDiffController } from "@/components/layout/use-git-and-diff-controller";
import { createDefaultGitTraceState, type GitBlameAttribution, type GitTraceState } from "@/features/git/git-trace-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

const gitTraceState = vi.hoisted(() => ({
  current: {
    blameStatus: "idle",
    blameLines: [],
    blameAttributions: [],
    selectedLine: null,
    selectedCommit: null,
    detailStatus: "idle",
    detail: null,
    message: undefined,
  } as GitTraceState,
}));

vi.mock("@/components/layout/use-git-trace", () => ({
  useGitTrace: () => ({ gitTraceState: gitTraceState.current }),
}));

describe("useGitAndDiffController", () => {
  beforeEach(() => {
    gitTraceState.current = createDefaultGitTraceState();
  });

  it("loads workspace diff into the git changes view", async () => {
    const loadDiff = vi.fn(async () => [
      "diff --git a/entry/src/main.ets b/entry/src/main.ets",
      "--- a/entry/src/main.ets",
      "+++ b/entry/src/main.ets",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n"));
    const showGit = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({ loadDiff }),
      showGit,
      onStatusChange,
    });

    await act(async () => {
      await result.current.loadDiff();
    });

    expect(loadDiff).toHaveBeenCalledWith("/project");
    expect(result.current.gitToolView).toBe("changes");
    expect(result.current.diffFiles).toHaveLength(1);
    expect(showGit).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Diff loaded");
  });

  it("opens commit patches in the changes view", () => {
    const showGit = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({ showGit, onStatusChange });

    act(() => {
      result.current.openGitTraceCommitDiff([
        "diff --git a/file.ets b/file.ets",
        "--- a/file.ets",
        "+++ b/file.ets",
        "@@ -1 +1 @@",
        "-a",
        "+b",
      ].join("\n"));
    });

    expect(result.current.gitToolView).toBe("changes");
    expect(result.current.diffFiles).toHaveLength(1);
    expect(showGit).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Commit diff loaded");
  });

  it("selects current-line blame from the trace state", () => {
    const attribution = blame({ bufferLine: 7, commit: "abcdef123456", shortCommit: "abcdef1" });
    gitTraceState.current = traceState({ blameAttributions: [attribution] });
    const onStatusChange = vi.fn();
    const { result } = renderHarness({ activeLine: 7, onStatusChange });

    act(() => {
      result.current.showCurrentLineBlame();
    });

    expect(result.current.selectedBlameAttribution).toEqual(attribution);
    expect(result.current.currentLineBlame).toBe("Blame: Ada, 2 days ago");
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("reports unavailable blame refresh when no file is active", () => {
    const onStatusChange = vi.fn();
    const { result } = renderHarness({ activePath: null, onStatusChange });

    act(() => {
      result.current.refreshGitBlame();
    });

    expect(onStatusChange).toHaveBeenCalledWith("Git Blame unavailable: no active file");
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  const workspaceApiValue = overrides.workspaceApi ?? workspaceApi({});
  const showGit = overrides.showGit ?? vi.fn();
  const setEditorSelection = overrides.setEditorSelection ?? vi.fn();
  const focusEditor = overrides.focusEditor ?? vi.fn();
  const onStatusChange = overrides.onStatusChange ?? vi.fn();

  return renderHook(() => useGitAndDiffController({
    workspaceRootPath: "workspaceRootPath" in overrides ? overrides.workspaceRootPath ?? null : "/project",
    workspaceApi: workspaceApiValue,
    activePath: "activePath" in overrides ? overrides.activePath ?? null : "/project/entry/src/main.ets",
    activeLine: overrides.activeLine ?? 1,
    activeText: overrides.activeText ?? "content",
    baseText: overrides.baseText ?? "content",
    gitToolVisible: overrides.gitToolVisible ?? true,
    showGit,
    setEditorSelection,
    focusEditor,
    onStatusChange,
  }));
}

type HarnessOptions = {
  workspaceRootPath: string | null;
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  activeLine: number;
  activeText: string;
  baseText: string;
  gitToolVisible: boolean;
  showGit: () => void;
  setEditorSelection: (selection: { line: number; column: number }) => void;
  focusEditor: () => void;
  onStatusChange: (message: string) => void;
};

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    loadDiff: vi.fn(async () => ""),
    ...overrides,
  } as unknown as WorkspaceApi;
}

function traceState(overrides: Partial<GitTraceState>): GitTraceState {
  return {
    ...createDefaultGitTraceState(),
    ...overrides,
  };
}

function blame(overrides: Partial<GitBlameAttribution> = {}): GitBlameAttribution {
  return {
    bufferLine: 1,
    status: "committed",
    commit: "abcdef123456",
    shortCommit: "abcdef1",
    author: "Ada",
    relativeTime: "2 days ago",
    ...overrides,
  };
}
