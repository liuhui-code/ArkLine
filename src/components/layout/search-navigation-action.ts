import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

type SearchNavigationActionContext = {
  now?: () => number;
  rememberCurrentLocation: () => void;
  closeSearchOverlayForNavigation: () => void;
  navigateToLocation: (location: { path: string; line: number; column: number }, label: "Usage") => Promise<void>;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
};

export type SearchResultNavigationInput = SearchNavigationActionContext & {
  path: string;
  line: number;
  column: number;
};

export type SearchCandidateNavigationInput = SearchNavigationActionContext & {
  candidate: SearchCandidate;
};

export async function openSearchResultNavigation({
  path,
  line,
  column,
  now = Date.now,
  rememberCurrentLocation,
  closeSearchOverlayForNavigation,
  navigateToLocation,
  recordUiInteraction,
}: SearchResultNavigationInput) {
  const startedAt = now();
  rememberCurrentLocation();
  closeSearchOverlayForNavigation();
  await navigateToLocation({ path, line, column }, "Usage");
  recordUiInteraction?.("searchJump", getPathBasename(path), startedAt, now());
}

export async function openSearchCandidateNavigation({
  candidate,
  now = Date.now,
  rememberCurrentLocation,
  closeSearchOverlayForNavigation,
  navigateToLocation,
  recordUiInteraction,
}: SearchCandidateNavigationInput) {
  if (!candidate.path) return;
  const startedAt = now();
  rememberCurrentLocation();
  closeSearchOverlayForNavigation();
  await navigateToLocation({
    path: candidate.path,
    line: candidate.line ?? 1,
    column: candidate.column ?? 1,
  }, "Usage");
  recordUiInteraction?.("searchJump", candidate.title, startedAt, now());
}
