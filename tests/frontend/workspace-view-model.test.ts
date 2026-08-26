import { describe, expect, it } from "vitest";
import { toWorkspaceViewModel } from "@/features/workspace/workspace-view-model";

describe("workspace view model", () => {
  it("keeps a root-only open snapshot distinct from a completed zero-file scan", () => {
    const workspace = toWorkspaceViewModel({
      rootName: "HugeWorkspace",
      rootPath: "/workspace",
      files: [],
    });

    expect(workspace.scanSummary).toBeNull();
  });
});
