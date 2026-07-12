import type { WorkspaceTextSearchOptions } from "@/features/search/workspace-text-search";

export type SearchTextOptionKey = keyof Pick<WorkspaceTextSearchOptions, "caseSensitive" | "wholeWord">;

export function toggleSearchTextOption(
  options: WorkspaceTextSearchOptions,
  key: SearchTextOptionKey,
): WorkspaceTextSearchOptions {
  return { ...options, [key]: !options[key] };
}
