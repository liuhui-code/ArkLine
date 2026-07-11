import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { WorkspaceTextSearchMatch } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import { getPathBasename } from "@/features/workspace/workspace-store";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";

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

export type SelectedSearchNavigationTarget =
  | { kind: "candidate"; candidate: SearchCandidate }
  | { kind: "result"; result: WorkspaceTextSearchMatch };

export type SelectedSearchNavigationInput = {
  mode: SearchEverywhereMode;
  selectedIndex: number;
  candidates: SearchCandidate[];
  matches: WorkspaceTextSearchMatch[];
};

export type SelectedSearchNavigationActionInput = SearchNavigationActionContext & SelectedSearchNavigationInput;

export function resolveSelectedSearchNavigationTarget({
  mode,
  selectedIndex,
  candidates,
  matches,
}: SelectedSearchNavigationInput): SelectedSearchNavigationTarget | null {
  if (mode === "searchEverywhere") {
    const candidate = candidates[selectedIndex];
    return candidate ? { kind: "candidate", candidate } : null;
  }
  const result = matches[selectedIndex];
  return result ? { kind: "result", result } : null;
}

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

export async function openSelectedSearchNavigation(input: SelectedSearchNavigationActionInput) {
  const target = resolveSelectedSearchNavigationTarget(input);
  if (target?.kind === "candidate") {
    await openSearchCandidateNavigation({ ...input, candidate: target.candidate });
    return;
  }
  if (target?.kind === "result") {
    await openSearchResultNavigation({
      ...input,
      path: target.result.path,
      line: target.result.line,
      column: target.result.column,
    });
  }
}
