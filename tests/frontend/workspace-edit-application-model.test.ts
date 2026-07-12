import { describe, expect, it } from "vitest";
import { buildAppliedWorkspaceEditUpdate } from "@/components/layout/workspace-edit-application-model";
import type { WorkspaceEditPlan } from "@/features/code-actions/code-action-model";

describe("workspace edit application model", () => {
  it("renames directory-visible files and reports index deltas", () => {
    const update = buildAppliedWorkspaceEditUpdate({
      visibleFiles: [
        "/workspace/src/old/A.ets",
        "/workspace/src/old/nested/B.ets",
        "/workspace/src/keep/C.ets",
      ],
      plan: plan([{
        kind: "renameDirectory",
        oldPath: "/workspace/src/old",
        newPath: "/workspace/src/new",
        overwrite: false,
      }]),
    });

    expect(update.visibleFiles).toEqual([
      "/workspace/src/keep/C.ets",
      "/workspace/src/new/A.ets",
      "/workspace/src/new/nested/B.ets",
    ]);
    expect(update.addedIndexPaths).toEqual([
      "/workspace/src/new/A.ets",
      "/workspace/src/new/nested/B.ets",
    ]);
    expect(update.removedIndexPaths).toEqual([
      "/workspace/src/old/A.ets",
      "/workspace/src/old/nested/B.ets",
    ]);
    expect(update.fileTree.map((node) => node.path)).toEqual(update.visibleFiles);
  });

  it("removes deleted directory files and adds text-edited files", () => {
    const update = buildAppliedWorkspaceEditUpdate({
      visibleFiles: [
        "/workspace/src/generated/A.ets",
        "/workspace/src/Entry.ets",
      ],
      plan: plan([
        { kind: "deleteDirectory", path: "/workspace/src/generated", recursive: true },
        {
          kind: "text",
          path: "/workspace/src/Entry.ets",
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
          newText: "x",
        },
      ]),
    });

    expect(update.visibleFiles).toEqual(["/workspace/src/Entry.ets"]);
    expect(update.addedIndexPaths).toEqual(["/workspace/src/Entry.ets"]);
    expect(update.removedIndexPaths).toEqual(["/workspace/src/generated/A.ets"]);
  });
});

function plan(operations: WorkspaceEditPlan["operations"]): WorkspaceEditPlan {
  return {
    id: "plan-1",
    title: "Plan",
    operations,
    conflicts: [],
    affectedFiles: [],
    undoLabel: "Undo",
    requiresPreview: false,
  };
}
