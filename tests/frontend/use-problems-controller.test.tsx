import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProblemsController } from "@/components/layout/use-problems-controller";
import type { ProblemItem } from "@/features/problems/problems-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("useProblemsController", () => {
  it("preserves build diagnostics while replacing validation problems", async () => {
    const buildProblem = problem({ source: "build", message: "Build failed" });
    const lintProblem = problem({ source: "lint", message: "Unused import", line: 2 });
    const runValidation = vi.fn(async () => [lintProblem]);
    const { result } = renderHarness({ workspaceApi: workspaceApi({ runValidation }) });

    act(() => {
      result.current.replaceBuildProblems([buildProblem]);
    });
    await act(async () => {
      await result.current.refreshProblems("/project/main.ets", "content");
    });

    expect(result.current.problems).toEqual([buildProblem, lintProblem]);
    expect(runValidation).toHaveBeenCalledWith("/project/main.ets", "content");
  });

  it("runs lint for the active document and opens the problems tool", async () => {
    const lintProblem = problem({ source: "lint", message: "Missing semicolon" });
    const runValidation = vi.fn(async () => [lintProblem]);
    const showProblems = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      activePath: "/project/main.ets",
      activeContent: "let value = 1",
      workspaceApi: workspaceApi({ runValidation }),
      showProblems,
      onStatusChange,
    });

    await act(async () => {
      await result.current.runLint();
    });

    expect(runValidation).toHaveBeenCalledWith("/project/main.ets", "let value = 1");
    expect(result.current.problems).toEqual([lintProblem]);
    expect(showProblems).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Lint complete");
  });

  it("ignores lint when no document is active and resets problems", async () => {
    const buildProblem = problem({ source: "build", message: "Build failed" });
    const runValidation = vi.fn(async () => [problem({ source: "lint" })]);
    const showProblems = vi.fn();
    const { result } = renderHarness({
      activePath: null,
      workspaceApi: workspaceApi({ runValidation }),
      showProblems,
    });

    act(() => {
      result.current.replaceBuildProblems([buildProblem]);
    });
    await act(async () => {
      await result.current.runLint();
    });
    act(() => {
      result.current.resetProblems();
    });

    expect(runValidation).not.toHaveBeenCalled();
    expect(showProblems).not.toHaveBeenCalled();
    expect(result.current.problems).toEqual([]);
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  return renderHook(() => useProblemsController({
    workspaceApi: overrides.workspaceApi ?? workspaceApi({}),
    activePath: "activePath" in overrides ? overrides.activePath ?? null : "/project/main.ets",
    getActiveContent: () => overrides.activeContent ?? "content",
    showProblems: overrides.showProblems ?? vi.fn(),
    onStatusChange: overrides.onStatusChange ?? vi.fn(),
  }));
}

type HarnessOptions = {
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  activeContent: string;
  showProblems: () => void;
  onStatusChange: (message: string) => void;
};

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    runValidation: vi.fn(async () => []),
    loadDiff: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceApi;
}

function problem(overrides: Partial<ProblemItem> = {}): ProblemItem {
  return {
    source: "lint",
    severity: "error",
    path: "/project/main.ets",
    line: 1,
    column: 1,
    message: "Problem",
    ...overrides,
  };
}
