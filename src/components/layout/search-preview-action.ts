import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { OverlayKey } from "@/components/layout/shell-state";
import {
  type SearchFileReader,
  scheduleSelectedSearchPreviewWithReader,
} from "@/components/layout/search-file-reader";
import type { SearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import type { SearchSessionStore } from "@/features/search/search-session-store";

export type SearchPreviewActionOptions = {
  getActiveOverlay: () => OverlayKey;
  getMode: () => SearchEverywhereMode;
  delayMs: number;
  sessionStore: SearchSessionStore;
  interactionRuntime: SearchInteractionRuntime;
  readFile: SearchFileReader;
};

export function createSearchPreviewAction({
  getActiveOverlay,
  getMode,
  delayMs,
  sessionStore,
  interactionRuntime,
  readFile,
}: SearchPreviewActionOptions) {
  return (selectedIndex: number) => {
    scheduleSelectedSearchPreviewWithReader({
      activeOverlay: getActiveOverlay(),
      mode: getMode(),
      selectedIndex,
      delayMs,
      sessionStore,
      interactionRuntime,
      readFile,
    });
  };
}
