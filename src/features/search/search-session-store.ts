import { useSyncExternalStore } from "react";
import type { WorkspaceTextSearchCursor, WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";

const emptyResult: WorkspaceTextSearchResult = { query: { kind: "text", query: "" }, matches: [] };

export type SearchSessionSnapshot = {
  result: WorkspaceTextSearchResult;
  candidates: SearchCandidate[];
  truncationNotice: string | null;
  selectedIndex: number;
  previewContent: string | null;
  entityNextCursor: number | null;
  textNextCursor: WorkspaceTextSearchCursor | null;
  textPageLoading: boolean;
  indexReadiness: WorkspaceIndexReadiness | null;
};

export type SearchSessionStore = ReturnType<typeof createSearchSessionStore>;

export function createSearchSessionStore() {
  let snapshot: SearchSessionSnapshot = {
    result: emptyResult,
    candidates: [],
    truncationNotice: null,
    selectedIndex: 0,
    previewContent: null,
    entityNextCursor: null,
    textNextCursor: null,
    textPageLoading: false,
    indexReadiness: null,
  };
  const listeners = new Set<() => void>();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    patch(patch: Partial<SearchSessionSnapshot>) {
      snapshot = { ...snapshot, ...patch };
      emit();
    },
    clear(query = "") {
      snapshot = {
        ...snapshot,
        result: { query: { kind: "text", query }, matches: [] },
        candidates: [],
        truncationNotice: null,
        selectedIndex: 0,
        entityNextCursor: null,
        textNextCursor: null,
        textPageLoading: false,
        indexReadiness: null,
      };
      emit();
    },
  };
}

export function useSearchSessionSnapshot(store: SearchSessionStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
