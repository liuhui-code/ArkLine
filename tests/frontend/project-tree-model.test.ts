import { describe, expect, it } from "vitest";
import {
  buildProjectEntries,
  buildProjectTree,
  collectAncestorDirectories,
} from "@/components/layout/project-tree-model";

describe("project tree model", () => {
  it("builds sorted project entries from flat workspace files", () => {
    const root = buildProjectTree([
      { path: "/workspace/src/pages/Index.ets", name: "Index.ets", title: "Index.ets" },
      { path: "/workspace/src/EntryAbility.ets", name: "EntryAbility.ets", title: "EntryAbility.ets" },
    ]);

    const entries = buildProjectEntries(root, new Set(["/workspace/src"]));

    expect(entries.map((entry) => `${entry.depth}:${entry.kind}:${entry.label}`)).toEqual([
      "0:directory:src",
      "1:directory:pages",
      "1:file:EntryAbility.ets",
    ]);
  });

  it("adds a loading row for expanded lazy directories that are loading", () => {
    const root = buildProjectTree([], {
      lazyRoot: { name: "ArkDemo", path: "C:/samples/ArkDemo" },
      lazyChildren: {
        "C:\\samples\\ArkDemo": [{
          name: "entry",
          path: "C:/samples/ArkDemo/entry",
          kind: "directory",
          excluded: false,
          hasChildren: true,
        }],
      },
      lazyLoadingPaths: new Set(["C:\\samples\\ArkDemo\\entry"]),
    });

    const entries = buildProjectEntries(root, new Set(["C:\\samples\\ArkDemo", "C:\\samples\\ArkDemo\\entry"]));

    expect(entries.map((entry) => `${entry.depth}:${entry.kind}:${entry.label}`)).toEqual([
      "0:directory:ArkDemo",
      "1:directory:entry",
      "2:loading:Loading...",
    ]);
  });

  it("collects ancestor directories for the active file", () => {
    const root = buildProjectTree([
      { path: "/workspace/src/pages/Index.ets", name: "Index.ets", title: "Index.ets" },
    ]);

    expect(collectAncestorDirectories(root, "/workspace/src/pages/Index.ets")).toEqual([
      "/workspace/src/pages",
    ]);
  });
});
