import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { WorkspaceTextSearchOptions } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";

export type SearchControllerContext = {
  getMode: () => SearchEverywhereMode;
  getQuery: () => string;
  getRootPath: () => string | null;
  getScope: () => WorkspaceIndexQueryScope;
  getOptions: () => WorkspaceTextSearchOptions;
};

export function createSearchControllerContext(context: SearchControllerContext): SearchControllerContext {
  return context;
}
