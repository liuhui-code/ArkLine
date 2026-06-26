import { describe, expect, it } from "vitest";
import {
  createDeletePathPlan,
  createNewDirectoryPlan,
  createNewFilePlan,
  createRenamePathPlan,
} from "@/features/workspace/workspace-mutation-plans";

describe("workspace mutation plans", () => {
  it("creates a new file plan under a parent directory", () => {
    expect(createNewFilePlan("C:/workspace/src/pages", "Home.ets")).toMatchObject({
      id: "workspace.createFile.C:/workspace/src/pages/Home.ets",
      title: "Create File Home.ets",
      operations: [
        {
          kind: "createFile",
          path: "C:/workspace/src/pages/Home.ets",
          content: "",
          overwrite: false,
        },
      ],
    });
  });

  it("creates a new directory plan under a parent directory", () => {
    expect(createNewDirectoryPlan("/workspace/src", "pages")).toMatchObject({
      id: "workspace.createDirectory./workspace/src/pages",
      title: "Create Directory pages",
      operations: [
        {
          kind: "createDirectory",
          path: "/workspace/src/pages",
        },
      ],
    });
  });

  it("creates rename plans for files and directories", () => {
    expect(createRenamePathPlan("/workspace/src/Old.ets", "file", "New.ets").operations).toEqual([
      {
        kind: "renameFile",
        oldPath: "/workspace/src/Old.ets",
        newPath: "/workspace/src/New.ets",
        overwrite: false,
      },
    ]);

    expect(createRenamePathPlan("/workspace/src/old", "directory", "new").operations).toEqual([
      {
        kind: "renameDirectory",
        oldPath: "/workspace/src/old",
        newPath: "/workspace/src/new",
        overwrite: false,
      },
    ]);
  });

  it("creates delete plans for files and directories", () => {
    expect(createDeletePathPlan("/workspace/src/Unused.ets", "file").operations).toEqual([
      {
        kind: "deleteFile",
        path: "/workspace/src/Unused.ets",
        recursive: false,
      },
    ]);

    expect(createDeletePathPlan("/workspace/src/generated", "directory").operations).toEqual([
      {
        kind: "deleteDirectory",
        path: "/workspace/src/generated",
        recursive: true,
      },
    ]);
  });

  it("rejects empty names and nested path names", () => {
    expect(() => createNewFilePlan("/workspace/src", "")).toThrow("Name is required");
    expect(() => createNewDirectoryPlan("/workspace/src", "../escape")).toThrow("Name cannot contain path separators");
    expect(() => createRenamePathPlan("/workspace/src/Old.ets", "file", "nested/New.ets")).toThrow("Name cannot contain path separators");
  });
});
