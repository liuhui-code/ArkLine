import type { OverlayKey } from "@/components/layout/shell-state";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { scheduleSearchPreview } from "@/features/search/search-preview-loader";
import type { SearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import type { SearchSessionStore } from "@/features/search/search-session-store";

export type SearchPreviewSessionOptions = {
  activeOverlay: OverlayKey;
  mode: SearchEverywhereMode;
  selectedIndex: number;
  delayMs: number;
  sessionStore: SearchSessionStore;
  interactionRuntime: SearchInteractionRuntime;
  readFile: (path: string) => Promise<string | null>;
};

export function scheduleSelectedSearchPreview({
  activeOverlay,
  mode,
  selectedIndex,
  delayMs,
  sessionStore,
  interactionRuntime,
  readFile,
}: SearchPreviewSessionOptions) {
  if (activeOverlay !== "searchEverywhere" || mode === "searchEverywhere") {
    sessionStore.patch({ previewContent: null });
    return;
  }
  const selected = sessionStore.getSnapshot().result.matches[selectedIndex];
  if (!selected) {
    sessionStore.patch({ previewContent: null });
    return;
  }
  const requestId = interactionRuntime.startPreview();
  sessionStore.patch({ previewContent: null });
  scheduleSearchPreview({
    path: selected.path,
    requestId,
    delayMs,
    readFile,
    isCurrent: (id) => interactionRuntime.isCurrentPreview(id),
    onPreview: (content) => sessionStore.patch({ previewContent: content }),
  });
}
