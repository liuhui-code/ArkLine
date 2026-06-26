import { createWorkspaceIndexStore } from "@/features/workspace/workspace-index-store";
import type { WorkspaceViewModel } from "@/features/workspace/workspace-api";

function createWorkspace(overrides: Partial<WorkspaceViewModel> = {}): WorkspaceViewModel {
  return {
    rootName: "ArkDemo",
    rootPath: "C:/samples/ArkDemo",
    visibleFiles: [
      "C:/samples/ArkDemo/entry/src/main/ets/pages/Index.ets",
      "C:/samples/ArkDemo/entry/src/main/ets/components/IndexCard.ets",
      "C:/samples/ArkDemo/AppScope/app.json5",
    ],
    fileTree: [],
    scanSummary: {
      scannedFiles: 3,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [".git", "node_modules"],
    },
    ...overrides,
  };
}

describe("workspace index store", () => {
  it("indexes workspace files as queryable file candidates", () => {
    const store = createWorkspaceIndexStore();

    store.openWorkspace(createWorkspace());

    expect(store.state.status).toBe("ready");
    expect(store.queryQuickOpen("index").map((candidate) => candidate.path)).toEqual([
      "C:\\samples\\ArkDemo\\entry\\src\\main\\ets\\pages\\Index.ets",
      "C:\\samples\\ArkDemo\\entry\\src\\main\\ets\\components\\IndexCard.ets",
    ]);
    expect(store.queryQuickOpen("index")[0]).toMatchObject({
      source: "file",
      kind: "file",
      title: "Index.ets",
      freshness: "ready",
    });
  });

  it("marks candidates and scoped search paths as partial when the workspace scan is truncated", () => {
    const store = createWorkspaceIndexStore();

    store.openWorkspace(createWorkspace({
      scanSummary: {
        scannedFiles: 20_000,
        skippedEntries: 8,
        truncated: true,
        excludeRules: [".git", "node_modules", "oh_modules"],
      },
    }));

    expect(store.state.status).toBe("partial");
    expect(store.state.partialReason).toContain("20,000");
    expect(store.queryQuickOpen("index")[0]?.freshness).toBe("partial");
    expect(store.getTextSearchPaths()).toEqual([
      "C:\\samples\\ArkDemo\\entry\\src\\main\\ets\\pages\\Index.ets",
      "C:\\samples\\ArkDemo\\entry\\src\\main\\ets\\components\\IndexCard.ets",
      "C:\\samples\\ArkDemo\\AppScope\\app.json5",
    ]);
  });
});
