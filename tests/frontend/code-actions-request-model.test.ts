import { describe, expect, it, vi } from "vitest";
import {
  buildCodeActionsEditorRequest,
  codeActionsSourceStatus,
  emptyCodeActionsMessage,
  filterCodeActionsForSource,
} from "@/components/layout/code-actions-request-model";
import type { CodeAction } from "@/features/code-actions/code-action-model";

describe("code actions request model", () => {
  it("builds editor requests from the active document snapshot", () => {
    const getActiveContent = vi.fn(() => "struct Entry {}");

    expect(buildCodeActionsEditorRequest({
      activePath: "/workspace/Entry.ets",
      editorSelection: { line: 4, column: 9 },
      getActiveContent,
    })).toEqual({
      path: "/workspace/Entry.ets",
      line: 4,
      column: 9,
      content: "struct Entry {}",
    });
    expect(getActiveContent).toHaveBeenCalledTimes(1);
  });

  it("keeps source status and empty messages stable", () => {
    expect(codeActionsSourceStatus("all")).toBe("Code Actions");
    expect(codeActionsSourceStatus("rename")).toBe("Rename Symbol");
    expect(emptyCodeActionsMessage("all")).toBe("No code actions actions available");
    expect(emptyCodeActionsMessage("refactor")).toBe("No refactor actions available");
  });

  it("filters actions through the existing source matcher", () => {
    const actions: CodeAction[] = [
      { id: "rename", title: "Rename Symbol", kind: "refactor.rewrite", provider: "workspace", safety: "safe" },
      { id: "generate", title: "Generate Builder", kind: "generate", provider: "template", safety: "safe" },
    ];

    expect(filterCodeActionsForSource(actions, "rename").map((action) => action.id)).toEqual(["rename"]);
    expect(filterCodeActionsForSource(actions, "all").map((action) => action.id)).toEqual(["rename", "generate"]);
  });
});
