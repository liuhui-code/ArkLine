import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useWorkspaceResetController,
  type WorkspaceResetControllerActions,
} from "@/components/layout/use-workspace-reset-controller";

describe("useWorkspaceResetController", () => {
  it("resets cross-workspace UI state and reports workspace readiness", () => {
    const actions = resetActions();
    const { result } = renderHook(() => useWorkspaceResetController(actions));

    result.current.resetWorkspaceUi("Demo");

    expect(actions.resetTabs).toHaveBeenCalledTimes(1);
    expect(actions.resetProjectSelection).toHaveBeenCalledTimes(1);
    expect(actions.resetActiveDocument).toHaveBeenCalledTimes(1);
    expect(actions.resetQuickOpen).toHaveBeenCalledTimes(1);
    expect(actions.resetProjectPicker).toHaveBeenCalledTimes(1);
    expect(actions.resetOverlay).toHaveBeenCalledTimes(1);
    expect(actions.resetProblems).toHaveBeenCalledTimes(1);
    expect(actions.resetDiff).toHaveBeenCalledTimes(1);
    expect(actions.resetCodeActions).toHaveBeenCalledTimes(1);
    expect(actions.resetWorkspaceEdit).toHaveBeenCalledTimes(1);
    expect(actions.resetCompletion).toHaveBeenCalledTimes(1);
    expect(actions.resetUsageSearch).toHaveBeenCalledTimes(1);
    expect(actions.resetEditorState).toHaveBeenCalledTimes(1);
    expect(actions.resetDocumentCache).toHaveBeenCalledTimes(1);
    expect(actions.showBottomContent).toHaveBeenCalledTimes(1);
    expect(actions.onStatusChange).toHaveBeenCalledWith("Workspace ready: Demo");
  });
});

function resetActions(): WorkspaceResetControllerActions {
  return {
    resetTabs: vi.fn(),
    resetProjectSelection: vi.fn(),
    resetActiveDocument: vi.fn(),
    resetQuickOpen: vi.fn(),
    resetProjectPicker: vi.fn(),
    resetOverlay: vi.fn(),
    resetProblems: vi.fn(),
    resetDiff: vi.fn(),
    resetCodeActions: vi.fn(),
    resetWorkspaceEdit: vi.fn(),
    resetCompletion: vi.fn(),
    resetUsageSearch: vi.fn(),
    resetEditorState: vi.fn(),
    resetDocumentCache: vi.fn(),
    showBottomContent: vi.fn(),
    onStatusChange: vi.fn(),
  };
}
