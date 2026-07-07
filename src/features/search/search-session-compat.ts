import type { SearchSessionStore } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchSessionCompatFields = {
  readonly searchEverywhereResult: WorkspaceTextSearchResult;
  readonly searchEverywhereCandidates: SearchCandidate[];
  readonly searchEverywhereTruncationNotice: string | null;
  readonly searchEverywhereSelectedIndex: number;
  readonly searchEverywherePreviewContent: string | null;
};

export function searchSessionCompat<T extends object>(
  target: T,
  store: SearchSessionStore,
): T & SearchSessionCompatFields {
  return Object.defineProperties(target, {
    searchEverywhereResult: {
      get() {
        return store.getSnapshot().result;
      },
    },
    searchEverywhereCandidates: {
      get() {
        return store.getSnapshot().candidates;
      },
    },
    searchEverywhereTruncationNotice: {
      get() {
        return store.getSnapshot().truncationNotice;
      },
    },
    searchEverywhereSelectedIndex: {
      get() {
        return store.getSnapshot().selectedIndex;
      },
    },
    searchEverywherePreviewContent: {
      get() {
        return store.getSnapshot().previewContent;
      },
    },
  }) as T & SearchSessionCompatFields;
}
