import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAppShellActionRefs } from "@/components/layout/use-app-shell-action-refs";

describe("useAppShellActionRefs", () => {
  it("provides stable action refs with safe default callbacks", async () => {
    const { result, rerender } = renderHook(() => useAppShellActionRefs());
    const initial = result.current;

    expect(initial.completionActionsRef.current.clearCompletionSession()).toBeUndefined();
    expect(initial.completionActionsRef.current.clearTypingCompletionTimer()).toBeUndefined();
    await expect(initial.settingsActionsRef.current.indexSdkSymbolsForSettings({} as never)).resolves.toBeUndefined();
    await expect(initial.editorActionsRef.current.openFile("/workspace/A.ets")).resolves.toBeUndefined();
    await expect(initial.workspaceOpeningActionsRef.current.openWorkspace("/workspace")).resolves.toBeUndefined();

    initial.searchActionsRef.current.resetSearchOverlayState();
    initial.gitActionsRef.current.refreshGitBlame();
    initial.projectOpeningActionsRef.current.setProjectPathInput("/workspace");
    initial.projectOpeningActionsRef.current.setProjectOpenError(null);

    rerender();

    expect(result.current).toBe(initial);
  });
});
