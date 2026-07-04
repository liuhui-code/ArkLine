import { normalizePath } from "@/features/workspace/workspace-store";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type CommandPaletteItem = {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
};

type RecentFile = {
  path: string;
  title: string;
};

type RecentProject = {
  path: string;
  name: string;
};

export function buildCommandPaletteItems(
  query: string,
  items: CommandPaletteItem[],
) {
  const normalized = query.trim().toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(normalized));
}

export function filterRecentFileResults(openTabs: RecentFile[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return openTabs;
  }

  return openTabs.filter((tab) => tab.path.toLowerCase().includes(normalized) || tab.title.toLowerCase().includes(normalized));
}

export function filterRecentProjectResults(recentProjects: RecentProject[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return recentProjects;
  }

  return recentProjects.filter(
    (project) => project.path.toLowerCase().includes(normalized) || project.name.toLowerCase().includes(normalized),
  );
}

export function getOverlayLabel(
  activeOverlay: "quickOpen" | "searchEverywhere" | "recentFiles" | "recentProjects" | "goToLine" | "completion" | "commandPalette",
) {
  if (activeOverlay === "quickOpen") {
    return "Quick Open";
  }

  if (activeOverlay === "searchEverywhere") {
    return "Search Everywhere";
  }

  if (activeOverlay === "recentFiles") {
    return "Recent Files";
  }

  if (activeOverlay === "recentProjects") {
    return "Recent Projects";
  }

  if (activeOverlay === "goToLine") {
    return "Go to Line";
  }

  if (activeOverlay === "completion") {
    return "Completion";
  }

  return "Find Action";
}

export type SearchEverywhereOrderContext = {
  activePath?: string | null;
  recentPaths?: string[];
};

export type SearchEverywhereTruncationMetadata = {
  scope: WorkspaceIndexQueryScope;
  displayLimit: number;
  returnedCount: number;
  fetchedCount: number;
  truncated: boolean;
  hiddenCount: number;
};

export function capSearchEverywhereCandidates(
  candidates: SearchCandidate[],
  {
    scope,
    displayLimit,
  }: {
    scope: WorkspaceIndexQueryScope;
    displayLimit: number;
  },
) {
  const safeLimit = Math.max(0, displayLimit);
  const items = candidates.slice(0, safeLimit);
  const hiddenCount = Math.max(0, candidates.length - items.length);
  return {
    items,
    metadata: {
      scope,
      displayLimit: safeLimit,
      returnedCount: items.length,
      fetchedCount: candidates.length,
      truncated: hiddenCount > 0,
      hiddenCount,
    },
  };
}

export function orderSearchEverywhereCandidates(
  candidates: SearchCandidate[],
  context: SearchEverywhereOrderContext = {},
) {
  const activePath = context.activePath ? normalizePath(context.activePath) : null;
  const recentRanks = new Map(
    (context.recentPaths ?? [])
      .map(normalizePath)
      .map((path, index) => [path, index] as const),
  );

  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => (
      sourcePriority(left.candidate.source) - sourcePriority(right.candidate.source)
      || contextPriority(left.candidate, activePath, recentRanks) - contextPriority(right.candidate, activePath, recentRanks)
      || right.candidate.score - left.candidate.score
      || proximityPriority(right.candidate, activePath) - proximityPriority(left.candidate, activePath)
      || left.index - right.index
    ))
    .map(({ candidate }) => candidate);
}

function contextPriority(
  candidate: SearchCandidate,
  activePath: string | null,
  recentRanks: Map<string, number>,
) {
  if (!candidate.path) {
    return Number.MAX_SAFE_INTEGER;
  }
  const path = normalizePath(candidate.path);
  if (activePath && path === activePath) {
    return -2;
  }
  const recentRank = recentRanks.get(path);
  return recentRank === undefined ? Number.MAX_SAFE_INTEGER : recentRank;
}

function proximityPriority(candidate: SearchCandidate, activePath: string | null) {
  if (!activePath || !candidate.path) {
    return 0;
  }
  const activeSegments = directorySegments(activePath);
  const candidateSegments = directorySegments(normalizePath(candidate.path));
  let shared = 0;
  while (
    shared < activeSegments.length
    && shared < candidateSegments.length
    && activeSegments[shared] === candidateSegments[shared]
  ) {
    shared += 1;
  }
  return shared;
}

function directorySegments(path: string) {
  const normalized = normalizePath(path);
  const segments = normalized.split("/").filter(Boolean);
  return segments.slice(0, -1);
}

function sourcePriority(source: SearchCandidate["source"]) {
  const sourceOrder: Record<SearchCandidate["source"], number> = {
    class: 0,
    symbol: 1,
    file: 2,
    api: 3,
    action: 4,
    sdk: 5,
    text: 6,
  };
  return sourceOrder[source];
}
