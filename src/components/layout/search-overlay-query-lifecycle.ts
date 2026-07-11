import { useEffect, useRef, useState } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { OverlayKey } from "@/components/layout/shell-state";

export type SearchOverlayDebouncedQueryOptions = {
  activeOverlay: OverlayKey;
  quickOpenQuery: string;
  mode: SearchEverywhereMode;
  debounceMs: Record<SearchEverywhereMode, number>;
  navigationCloseHandledRef: { current: boolean };
  invalidateSearchSession: () => void;
};

export function useSearchOverlayDebouncedQuery({
  activeOverlay,
  quickOpenQuery,
  mode,
  debounceMs,
  navigationCloseHandledRef,
  invalidateSearchSession,
}: SearchOverlayDebouncedQueryOptions) {
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
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
      setDebouncedSearchQuery(quickOpenQuery);
      return;
    }
    inactiveSyncKeyRef.current = null;
    const timeout = window.setTimeout(() => setDebouncedSearchQuery(quickOpenQuery), debounceMs[mode]);
    return () => window.clearTimeout(timeout);
  }, [activeOverlay, debounceMs, mode, navigationCloseHandledRef, quickOpenQuery]);

  return {
    debouncedSearchQuery,
    resetDebouncedSearchQuery: () => setDebouncedSearchQuery(""),
  };
}
