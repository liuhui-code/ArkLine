import {
  searchWorkspaceText,
  type WorkspaceTextSearchCursor,
  type WorkspaceTextSearchOptions,
  type WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import { normalizePath } from "@/features/workspace/workspace-store";

export type ReadSearchFileForSearchInput = {
  path: string;
  activePath: string | null;
  getOpenDocumentContent: (path: string) => string | null;
  getActiveContent: () => string;
  openFile: (path: string) => Promise<string>;
  allowBackendRead?: boolean;
};

export type RunFallbackTextSearchInput = {
  query: string;
  dirty: boolean;
  generation: number;
  cursor: WorkspaceTextSearchCursor | null;
  rootPath: string;
  options: WorkspaceTextSearchOptions;
  paths: string[];
  canUseNativeTextSearch: boolean;
  searchNative?: (options: {
    query: string;
    generation: number;
    cursor: WorkspaceTextSearchCursor | null;
    rootPath: string;
    options: WorkspaceTextSearchOptions;
    limit: number;
    contextLines: number;
  }) => Promise<WorkspaceTextSearchResult>;
  readFile: (path: string) => Promise<string | null>;
};

export async function readSearchFileForSearch({
  path,
  activePath,
  getOpenDocumentContent,
  getActiveContent,
  openFile,
  allowBackendRead = true,
}: ReadSearchFileForSearchInput) {
  if (normalizePath(path) === normalizePath(activePath ?? "")) {
    return getOpenDocumentContent(path) ?? getActiveContent();
  }
  const openContent = getOpenDocumentContent(path);
  if (openContent != null || !allowBackendRead) return openContent;
  return await openFile(path);
}

export function runFallbackTextSearch({
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
}: RunFallbackTextSearchInput) {
  if (rootPath && canUseNativeTextSearch && searchNative && !dirty) {
    return searchNative({
      query,
      generation,
      cursor,
      rootPath,
      options,
      limit: 50,
      contextLines: 2,
    });
  }
  return searchWorkspaceText({
    query,
    rootPath,
    paths,
    options,
    readFile: async (path) => {
      try {
        return await readFile(path);
      } catch {
        return null;
      }
    },
    limit: 50,
    cursor,
  });
}

export function canUseNativeTextSearchRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
