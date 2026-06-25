import { describe, expect, it } from "vitest";
import {
  formatCodeActionKind,
  requiresPreview,
  type CodeAction,
} from "@/features/code-actions/code-action-model";

describe("code action model", () => {
  it("formats action kinds into user-visible families", () => {
    expect(formatCodeActionKind("quickfix")).toBe("Quick Fix");
    expect(formatCodeActionKind("refactor.extract")).toBe("Refactor: Extract");
    expect(formatCodeActionKind("refactor.inline")).toBe("Refactor: Inline");
    expect(formatCodeActionKind("refactor.rewrite")).toBe("Refactor: Rewrite");
    expect(formatCodeActionKind("source")).toBe("Source Action");
    expect(formatCodeActionKind("generate")).toBe("Generate");
    expect(formatCodeActionKind("template")).toBe("Template");
  });

  it("requires preview for actions marked needsPreview or risky", () => {
    const baseAction: Omit<CodeAction, "id" | "safety"> = {
      title: "Rename file",
      kind: "source",
      provider: "workspace",
      editId: "edit-1",
    };

    expect(requiresPreview({ ...baseAction, id: "safe", safety: "safe" })).toBe(false);
    expect(requiresPreview({ ...baseAction, id: "preview", safety: "needsPreview" })).toBe(true);
    expect(requiresPreview({ ...baseAction, id: "risky", safety: "risky" })).toBe(true);
  });

  it("does not require preview for disabled safe actions without edits", () => {
    expect(requiresPreview({
      id: "missing-selection",
      title: "Extract method",
      kind: "refactor.extract",
      provider: "arkts",
      safety: "safe",
      disabledReason: "Select code to extract.",
    })).toBe(false);
  });
});
