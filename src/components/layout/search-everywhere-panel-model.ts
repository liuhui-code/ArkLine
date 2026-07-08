import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { SearchResultWindowItem } from "@/features/search/search-result-window";
import type { WorkspaceTextSearchMatch } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export function searchModePresentation(mode: SearchEverywhereMode, regexMode: boolean) {
  const searchKind = regexMode ? "Regular expression" : "Text";
  if (mode === "find") {
    return {
      title: "Find in Files",
      description: `${searchKind} search across the workspace`,
      searchPlaceholder: "Find in files, or use /regex/",
    };
  }
  if (mode === "replace") {
    return {
      title: "Replace in Files",
      description: `${searchKind} search with replacement preview`,
      searchPlaceholder: "Find text to replace, or use /regex/",
    };
  }
  return {
    title: "Search Everywhere",
    description: `${searchKind} search across the workspace`,
    searchPlaceholder: "Search code, or use /regex/",
  };
}

export function groupSearchMatches(matches: SearchResultWindowItem<WorkspaceTextSearchMatch>[]) {
  const groups: {
    path: string;
    fileName: string;
    relativePath: string;
    matches: SearchResultWindowItem<WorkspaceTextSearchMatch>[];
  }[] = [];
  const groupByPath = new Map<string, (typeof groups)[number]>();
  matches.forEach((match) => {
    let group = groupByPath.get(match.item.path);
    if (!group) {
      group = {
        path: match.item.path,
        fileName: match.item.fileName,
        relativePath: match.item.relativePath,
        matches: [],
      };
      groups.push(group);
      groupByPath.set(match.item.path, group);
    }
    group.matches.push(match);
  });
  return groups;
}

export function groupSearchCandidates(candidates: SearchResultWindowItem<SearchCandidate>[]) {
  const order: SearchCandidate["source"][] = ["class", "symbol", "file", "api", "action", "sdk", "text"];
  return order
    .map((source) => ({
      source,
      label: candidateGroupLabel(source),
      description: candidateGroupDescription(source),
      items: candidates.filter(({ item }) => item.source === source),
    }))
    .filter((group) => group.items.length > 0);
}

function candidateGroupLabel(source: SearchCandidate["source"]) {
  if (source === "class") return "Classes";
  if (source === "symbol") return "Symbols";
  if (source === "file") return "Files";
  if (source === "action") return "Actions";
  if (source === "api") return "API";
  if (source === "sdk") return "SDK";
  return "Text";
}

function candidateGroupDescription(source: SearchCandidate["source"]) {
  if (source === "class") return "types and ArkUI structs";
  if (source === "symbol") return "functions and methods";
  if (source === "file") return "workspace files";
  if (source === "action") return "commands";
  if (source === "api") return "SDK and system APIs";
  if (source === "sdk") return "SDK declarations";
  return "content matches";
}
