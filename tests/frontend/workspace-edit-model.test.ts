import { describe, expect, it } from "vitest";
import {
  collectAffectedFiles,
  summarizeWorkspaceEditOperation,
  validateWorkspaceEditPlan,
  type WorkspaceEditPlan,
} from "@/features/code-actions/workspace-edit-model";

const basePlan: Omit<WorkspaceEditPlan, "operations"> = {
  id: "edit-1",
  title: "Update workspace",
  conflicts: [],
  affectedFiles: [],
  undoLabel: "Undo update workspace",
  requiresPreview: false,
};

describe("workspace edit model", () => {
  it("collects affected files in stable operation order without duplicates", () => {
    const plan: WorkspaceEditPlan = {
      ...basePlan,
      operations: [
        {
          kind: "text",
          path: "src/pages/Index.ets",
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          newText: "Entry()",
        },
        {
          kind: "renameFile",
          oldPath: "src/pages/Old.ets",
          newPath: "src/pages/New.ets",
          overwrite: false,
        },
        {
          kind: "deleteFile",
          path: "src/pages/Index.ets",
          recursive: false,
        },
        {
          kind: "createFile",
          path: "src/pages/New.ets",
          content: "",
          overwrite: false,
        },
      ],
    };

    expect(collectAffectedFiles(plan)).toEqual([
      "src/pages/Index.ets",
      "src/pages/Old.ets",
      "src/pages/New.ets",
    ]);
  });

  it("summarizes file and text operations for previews", () => {
    expect(summarizeWorkspaceEditOperation({
      kind: "text",
      path: "src/pages/Index.ets",
      range: { startLine: 4, startColumn: 3, endLine: 4, endColumn: 9 },
      newText: "Button",
    })).toBe("Edit src/pages/Index.ets at 4:3-4:9");

    expect(summarizeWorkspaceEditOperation({
      kind: "createFile",
      path: "src/pages/About.ets",
      content: "",
      overwrite: false,
    })).toBe("Create src/pages/About.ets");

    expect(summarizeWorkspaceEditOperation({
      kind: "renameFile",
      oldPath: "src/pages/Old.ets",
      newPath: "src/pages/New.ets",
      overwrite: false,
    })).toBe("Rename src/pages/Old.ets to src/pages/New.ets");

    expect(summarizeWorkspaceEditOperation({
      kind: "deleteFile",
      path: "src/pages/Unused.ets",
      recursive: false,
    })).toBe("Delete src/pages/Unused.ets");
  });

  it("accepts valid text ranges", () => {
    const plan: WorkspaceEditPlan = {
      ...basePlan,
      operations: [
        {
          kind: "text",
          path: "src/pages/Index.ets",
          range: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 5 },
          newText: "replacement",
        },
      ],
    };

    expect(validateWorkspaceEditPlan(plan)).toEqual([]);
  });

  it("rejects inverted and non-positive text ranges", () => {
    const plan: WorkspaceEditPlan = {
      ...basePlan,
      operations: [
        {
          kind: "text",
          path: "src/pages/InvertedLine.ets",
          range: { startLine: 5, startColumn: 1, endLine: 4, endColumn: 1 },
          newText: "",
        },
        {
          kind: "text",
          path: "src/pages/InvertedColumn.ets",
          range: { startLine: 4, startColumn: 8, endLine: 4, endColumn: 2 },
          newText: "",
        },
        {
          kind: "text",
          path: "src/pages/Zero.ets",
          range: { startLine: 0, startColumn: 1, endLine: 1, endColumn: 1 },
          newText: "",
        },
      ],
    };

    expect(validateWorkspaceEditPlan(plan)).toEqual([
      "Operation 1 has an inverted text range.",
      "Operation 2 has an inverted text range.",
      "Operation 3 has a non-positive text range position.",
    ]);
  });
});
