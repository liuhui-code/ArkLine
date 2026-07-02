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
    },
    closeTab(path?: string) {
      const targetPath = normalizePath(path ?? state.activePath ?? "");
      if (!targetPath) {
        return;
      }

      const closingIndex = state.openTabs.findIndex((entry) => entry.path === targetPath);
      if (closingIndex < 0) {
        return;
      }

      state.openTabs.splice(closingIndex, 1);

      if (state.activePath !== targetPath) {
        return;
      }

      const nextActiveTab = state.openTabs[closingIndex] ?? state.openTabs[closingIndex - 1] ?? null;
      state.activePath = nextActiveTab?.path ?? null;
    },
    closeOtherTabs(path: string) {
      const targetPath = normalizePath(path);
      const targetTab = state.openTabs.find((entry) => entry.path === targetPath);
      if (!targetTab) {
        return;
      }

      state.openTabs = [targetTab];
      state.activePath = targetPath;
    },
    closeTabsToRight(path: string) {
      const targetPath = normalizePath(path);
      const targetIndex = state.openTabs.findIndex((entry) => entry.path === targetPath);
      if (targetIndex < 0) {
        return;
      }

      const closedPaths = new Set(state.openTabs.slice(targetIndex + 1).map((entry) => entry.path));
      state.openTabs.splice(targetIndex + 1);
      if (state.activePath && closedPaths.has(state.activePath)) {
        state.activePath = targetPath;
      }
    }
  };
}
