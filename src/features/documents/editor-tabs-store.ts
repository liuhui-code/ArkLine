import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";
import type { createDocumentStore } from "@/features/documents/document-store";

type DocumentStore = ReturnType<typeof createDocumentStore>;

export type EditorTab = {
  path: string;
  title: string;
  isDirty: boolean;
};

export type EditorTabsState = {
  activePath: string | null;
  openTabs: EditorTab[];
  recentFiles: string[];
};

function dedupeMostRecent(items: string[], value: string) {
  return [value, ...items.filter((item) => item !== value)];
}

export function createEditorTabsStore(documents: DocumentStore) {
  const state: EditorTabsState = {
    activePath: null,
    openTabs: [],
    recentFiles: []
  };

  function syncDirtyState(path: string) {
    const record = documents.getDocument(path);
    const tab = state.openTabs.find((entry) => entry.path === path);

    if (record && tab) {
      tab.isDirty = record.isDirty;
    }
  }

  documents.subscribe((path) => {
    syncDirtyState(path);
  });

  return {
    state,
    openTab(path: string) {
      const normalized = normalizePath(path);
      const existing = state.openTabs.find((entry) => entry.path === normalized);

      if (!existing) {
        state.openTabs.push({
          path: normalized,
          title: getPathBasename(normalized),
          isDirty: documents.getDocument(normalized)?.isDirty ?? false
        });
      }

      state.activePath = normalized;
      state.recentFiles = dedupeMostRecent(state.recentFiles, normalized);
      syncDirtyState(normalized);
    }
  };
}
