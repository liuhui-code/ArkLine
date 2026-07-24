import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";
import type { createDocumentStore } from "@/features/documents/document-store";

type DocumentStore = ReturnType<typeof createDocumentStore>;

export type EditorTab = {
  path: string;
  title: string;
  isDirty: boolean;
  isPreview?: true;
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
      if (record.isDirty) delete tab.isPreview;
    }
  }

  function replaceCleanPreview(nextPath: string) {
    const previewIndex = state.openTabs.findIndex((tab) => (
      tab.isPreview && tab.path !== nextPath
    ));
    if (previewIndex < 0) return;
    const preview = state.openTabs[previewIndex];
    if (!preview) return;
    if (documents.getDocument(preview.path)?.isDirty) {
      delete preview.isPreview;
      preview.isDirty = true;
      return;
    }
    state.openTabs.splice(previewIndex, 1);
    documents.releaseDocument(preview.path);
  }

  documents.subscribe((path) => {
    syncDirtyState(path);
  });

  return {
    state,
    openTab(path: string, disposition: "pinned" | "preview" = "pinned") {
      const normalized = normalizePath(path);
      const existing = state.openTabs.find((entry) => entry.path === normalized);

      if (!existing) {
        if (disposition === "preview") replaceCleanPreview(normalized);
        state.openTabs.push({
          path: normalized,
          title: getPathBasename(normalized),
          isDirty: documents.getDocument(normalized)?.isDirty ?? false,
          ...(disposition === "preview" ? { isPreview: true as const } : {}),
        });
      } else if (disposition === "pinned") {
        delete existing.isPreview;
      }

      state.activePath = normalized;
      state.recentFiles = dedupeMostRecent(state.recentFiles, normalized);
      syncDirtyState(normalized);
    },
    pinTab(path: string) {
      const tab = state.openTabs.find((entry) => entry.path === normalizePath(path));
      if (tab) delete tab.isPreview;
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
