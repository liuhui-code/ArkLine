import {
  DEFAULT_WORKSPACE_EXCLUDES,
  createWorkspaceStore,
  normalizePath
} from "@/features/workspace/workspace-store";
import { createDocumentStore } from "@/features/documents/document-store";
import { createEditorTabsStore } from "@/features/documents/editor-tabs-store";

describe("workspace store", () => {
  it("normalizes Windows paths and filters default excludes on open", () => {
    const store = createWorkspaceStore();

    store.openWorkspace({
      rootPath: "C:/code/ArkLine",
      files: [
        "C:/code/ArkLine/src/main.ets",
        "C:/code/ArkLine/node_modules/react/index.js",
        "C:/code/ArkLine/build/output.js",
        "C:/code/ArkLine/.git/config",
        "C:/code/ArkLine/.hvigor/cache.bin",
        "C:/code/ArkLine/AppScope/app.json5"
      ]
    });

    expect(store.state.rootPath).toBe("C:\\code\\ArkLine");
    expect(store.state.visibleFiles).toEqual([
      "C:\\code\\ArkLine\\AppScope\\app.json5",
      "C:\\code\\ArkLine\\src\\main.ets"
    ]);
    expect(DEFAULT_WORKSPACE_EXCLUDES).toEqual([
      ".git",
      ".hvigor",
      "build",
      "node_modules"
    ]);
  });

  it("tracks recent projects without duplicating the current workspace", () => {
    const store = createWorkspaceStore();

    store.openWorkspace({
      rootPath: "C:/code/ArkLine",
      files: ["C:/code/ArkLine/src/main.ets"]
    });
    store.openWorkspace({
      rootPath: "C:/code/ArkLine",
      files: ["C:/code/ArkLine/src/main.ets"]
    });
    store.openWorkspace({
      rootPath: "D:/samples/Demo",
      files: ["D:/samples/Demo/entry.ets"]
    });

    expect(store.state.recentProjects).toEqual([
      "D:\\samples\\Demo",
      "C:\\code\\ArkLine"
    ]);
  });
});

describe("document and tab stores", () => {
  it("tracks dirty state and save snapshots per open document", () => {
    const documents = createDocumentStore();
    const tabs = createEditorTabsStore(documents);

    documents.openDocument("C:/code/ArkLine/src/main.ets", "hello");
    tabs.openTab("C:/code/ArkLine/src/main.ets");

    documents.updateDocument("C:/code/ArkLine/src/main.ets", "hello world");
    expect(documents.getDocument("C:/code/ArkLine/src/main.ets")?.isDirty).toBe(true);
    expect(tabs.state.openTabs[0]?.isDirty).toBe(true);

    documents.saveDocument("C:/code/ArkLine/src/main.ets");
    expect(documents.getDocument("C:/code/ArkLine/src/main.ets")?.isDirty).toBe(false);
    expect(tabs.state.openTabs[0]?.isDirty).toBe(false);
  });

  it("records recent files in most-recent-first order without duplicates", () => {
    const documents = createDocumentStore();
    const tabs = createEditorTabsStore(documents);

    tabs.openTab("C:/code/ArkLine/src/main.ets");
    tabs.openTab("C:/code/ArkLine/AppScope/app.json5");
    tabs.openTab("C:/code/ArkLine/src/main.ets");

    expect(tabs.state.recentFiles).toEqual([
      normalizePath("C:/code/ArkLine/src/main.ets"),
      normalizePath("C:/code/ArkLine/AppScope/app.json5")
    ]);
  });
});
