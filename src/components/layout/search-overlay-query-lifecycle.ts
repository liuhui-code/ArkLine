import { useEffect, useRef } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { OverlayKey } from "@/components/layout/shell-state";

export type SearchOverlayDebouncedQueryOptions = {
  activeOverlay: OverlayKey;
  quickOpenQuery: string;
  mode: SearchEverywhereMode;
  navigationCloseHandledRef: { current: boolean };
  invalidateSearchSession: () => void;
};

export function useSearchOverlayDebouncedQuery({
  activeOverlay,
  quickOpenQuery,
  mode,
  navigationCloseHandledRef,
  invalidateSearchSession,
}: SearchOverlayDebouncedQueryOptions) {
  const invalidateSearchSessionRef = useRef(invalidateSearchSession);
  const inactiveSyncKeyRef = useRef<string | null>(null);
  invalidateSearchSessionRef.current = invalidateSearchSession;

  useEffect(() => {
    if (activeOverlay !== "searchEverywhere") {
      const inactiveSyncKey = `${activeOverlay}:${quickOpenQuery}`;
      if (inactiveSyncKeyRef.current !== inactiveSyncKey) {
        inactiveSyncKeyRef.current = inactiveSyncKey;
        if (navigationCloseHandledRef.current) {
          navigationCloseHandledRef.current = false;
        } else {
          invalidateSearchSessionRef.current();
        }
      }
      return;
    }
    inactiveSyncKeyRef.current = null;
  }, [activeOverlay, mode, navigationCloseHandledRef, quickOpenQuery]);

  return {
    debouncedSearchQuery: quickOpenQuery,
    resetDebouncedSearchQuery: () => undefined,
  };
}
