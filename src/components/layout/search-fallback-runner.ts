import {
  runFallbackTextSearch,
} from "@/components/layout/search-text-fallback";
import type {
  WorkspaceTextSearchCursor,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";

export type SearchFallbackRunnerInput = {
  query: string;
  dirty: boolean;
  generation: number;
  cursor: WorkspaceTextSearchCursor | null;
  rootPath: string;
  options: WorkspaceTextSearchOptions;
  paths: string[];
  canUseNativeTextSearch: boolean;
  searchNative?: Parameters<typeof runFallbackTextSearch>[0]["searchNative"];
  readFile: (path: string) => Promise<string | null>;
};

export function runSearchFallbackText({
  query,
  dirty,
  generation,
  cursor,
  rootPath,
  options,
  paths,
  canUseNativeTextSearch,
  searchNative,
  readFile,
}: SearchFallbackRunnerInput): Promise<WorkspaceTextSearchResult> {
  return runFallbackTextSearch({
    query,
    dirty,
    generation,
    cursor,
    rootPath,
    options,
    paths,
    canUseNativeTextSearch,
    searchNative,
    readFile,
  });
}
