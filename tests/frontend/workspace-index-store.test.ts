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

  it("preserves query readiness metadata for partial and stale index-backed results", () => {
    const store = createWorkspaceIndexStore();

    store.replaceQueryReadiness({
      rootPath: "C:/samples/ArkDemo",
      requestedGeneration: 12,
      servedGeneration: 12,
      state: "partial",
      reason: "scan truncated",
      retryable: true,
    });

    expect(store.state.queryReadiness).toEqual({
      rootPath: "C:\\samples\\ArkDemo",
      requestedGeneration: 12,
      servedGeneration: 12,
      state: "partial",
      reason: "scan truncated",
      retryable: true,
    });

    store.replaceQueryReadiness({
      rootPath: "C:/samples/ArkDemo",
      requestedGeneration: 13,
      servedGeneration: 12,
      state: "stale",
      reason: "Served generation 12 is older than requested generation 13",
      retryable: true,
    });

    expect(store.state.queryReadiness?.state).toBe("stale");
    expect(store.state.queryReadiness?.servedGeneration).toBe(12);
  });

  it("adds a lazy-tree file without resetting indexed symbols or readiness", () => {
    const store = createWorkspaceIndexStore();
    store.replaceState({
      status: "partial",
      rootPath: "C:/samples/ArkDemo",
      filePaths: ["C:/samples/ArkDemo/src/A.ets"],
      symbols: [{
        source: "class",
        kind: "class",
        name: "A",
        path: "C:/samples/ArkDemo/src/A.ets",
        line: 1,
        column: 1,
      }],
      indexedAt: 42,
      partialReason: "background indexing",
    });

    store.includeFilePath("C:/samples/ArkDemo/src/B.ets");
    store.includeFilePath("C:/samples/ArkDemo/src/B.ets");

    expect(store.state.filePaths).toEqual([
      "C:\\samples\\ArkDemo\\src\\A.ets",
      "C:\\samples\\ArkDemo\\src\\B.ets",
    ]);
    expect(store.state.symbols).toHaveLength(1);
    expect(store.state.indexedAt).toBe(42);
    expect(store.state.status).toBe("partial");
  });

  it("queries search everywhere candidates across classes symbols and files", () => {
    const store = createWorkspaceIndexStore();

    store.replaceState({
      status: "ready",
      rootPath: "C:/samples/ArkDemo",
      filePaths: ["C:/samples/ArkDemo/entry/src/main/ets/pages/LoginPage.ets"],
      symbols: [
        {
          source: "class",
          kind: "class",
          name: "LoginController",
          path: "C:/samples/ArkDemo/entry/src/main/ets/pages/LoginPage.ets",
          line: 3,
          column: 7,
        },
        {
          source: "symbol",
          kind: "method",
          name: "submitLogin",
          path: "C:/samples/ArkDemo/entry/src/main/ets/pages/LoginPage.ets",
          line: 8,
          column: 11,
          container: "LoginController",
        },
      ],
      indexedAt: 1,
      partialReason: null,
    });

    expect(store.querySearchEverywhere("login", 8).map((candidate) => ({
      source: candidate.source,
      title: candidate.title,
      line: candidate.line,
    }))).toEqual([
      { source: "class", title: "LoginController", line: 3 },
      { source: "symbol", title: "submitLogin", line: 8 },
      { source: "file", title: "LoginPage.ets", line: 1 },
    ]);
  });

  it("queries scoped file candidates without mixed search truncation", () => {
    const store = createWorkspaceIndexStore();
    const rootPath = "C:/samples/ArkDemo";

    store.replaceState({
      status: "ready",
      rootPath,
      filePaths: Array.from({ length: 24 }, (_value, index) => `${rootPath}/src/TargetFile${index}.ets`),
      symbols: Array.from({ length: 24 }, (_value, index) => ({
        source: "class" as const,
        kind: "class",
        name: `TargetClass${index}`,
        path: `${rootPath}/src/TargetClass${index}.ets`,
        line: 1,
        column: 7,
      })),
      indexedAt: 1,
      partialReason: null,
    });

    const mixedFiles = store.querySearchEverywhere("target", 8).filter((candidate) => candidate.source === "file");
    const scopedFiles = store.queryCandidates("target", "files", 8);

    expect(mixedFiles).toHaveLength(4);
    expect(scopedFiles).toHaveLength(8);
    expect(scopedFiles.every((candidate) => candidate.source === "file")).toBe(true);
  });
});
