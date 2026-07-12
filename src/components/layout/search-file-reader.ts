import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { OverlayKey } from "@/components/layout/shell-state";
import { readSearchFileForSearch } from "@/components/layout/search-text-fallback";
import type { SearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import {
  scheduleSelectedSearchPreview,
} from "@/features/search/search-preview-session";
import type { SearchSessionStore } from "@/features/search/search-session-store";

export type SearchFileReaderOptions = {
  activePath: string | null;
  getOpenDocumentContent: (path: string) => string | null;
  getActiveContent: () => string;
  openFile: (path: string) => Promise<string>;
};

export type SearchFileReader = (path: string, allowBackendRead?: boolean) => Promise<string | null>;

export type SearchPreviewReaderOptions = {
  activeOverlay: OverlayKey;
  mode: SearchEverywhereMode;
  selectedIndex: number;
  delayMs: number;
  sessionStore: SearchSessionStore;
  interactionRuntime: SearchInteractionRuntime;
  readFile: SearchFileReader;
};

export function createSearchFileReader({
  activePath,
  getOpenDocumentContent,
  getActiveContent,
  openFile,
}: SearchFileReaderOptions): SearchFileReader {
  return (path, allowBackendRead = true) => readSearchFileForSearch({
    path,
    activePath,
    getOpenDocumentContent,
    getActiveContent,
    openFile,
    allowBackendRead,
  });
}

export function scheduleSelectedSearchPreviewWithReader({
  activeOverlay,
  mode,
  selectedIndex,
  delayMs,
  sessionStore,
  interactionRuntime,
  readFile,
}: SearchPreviewReaderOptions) {
  scheduleSelectedSearchPreview({
    activeOverlay,
    mode,
    selectedIndex,
    delayMs,
    sessionStore,
    interactionRuntime,
    readFile: (path) => readFile(path, false),
  });
}
