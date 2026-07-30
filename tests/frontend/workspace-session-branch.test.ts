import { getWorkspaceSessionActiveFilePath } from "@/components/layout/use-workspace-opening-controller";

describe("workspace session branch restoration", () => {
  const session = {
    activeFilePath: "/workspace/Main.ets",
    branchActiveFilePaths: {
      main: "/workspace/Main.ets",
      "feature/git": "/workspace/Feature.ets",
    },
  };

  it("restores the file recorded for the target branch", () => {
    expect(getWorkspaceSessionActiveFilePath(session, "feature/git")).toBe("/workspace/Feature.ets");
  });

  it("falls back to the project active file for a new branch", () => {
    expect(getWorkspaceSessionActiveFilePath(session, "feature/new")).toBe("/workspace/Main.ets");
    expect(getWorkspaceSessionActiveFilePath(session)).toBe("/workspace/Main.ets");
  });
});
