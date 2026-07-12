import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { OverlayKey } from "@/components/layout/shell-state";

export type SearchQueryEffectDispatcherInput = {
  activeOverlay: OverlayKey;
  mode: SearchEverywhereMode;
  query: string;
  hasWorkspace: boolean;
  startQuery: (kind: "searchEverywhere" | "text") => number;
  clearSearchResults: (query: string) => void;
  runEntitySearch: (requestId: number) => void;
  runTextSearch: (requestId: number) => void;
};

export function dispatchSearchOverlayQueryEffect({
  activeOverlay,
  mode,
  query,
  hasWorkspace,
  startQuery,
  clearSearchResults,
  runEntitySearch,
  runTextSearch,
}: SearchQueryEffectDispatcherInput) {
  if (activeOverlay !== "searchEverywhere") return;
  const requestId = startQuery(mode === "searchEverywhere" ? "searchEverywhere" : "text");
  if (!hasWorkspace) {
    clearSearchResults(query.trim());
    return;
  }
  if (mode === "searchEverywhere") {
    runEntitySearch(requestId);
    return;
  }
  runTextSearch(requestId);
}
