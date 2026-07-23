import { memo, type ComponentProps } from "react";
import { OverlaySurface } from "@/components/layout/OverlaySurface";
import {
  SearchOverlayContent,
  type SearchOverlayContentProps,
} from "@/components/layout/SearchOverlayContent";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";
import { useLatestCallback } from "@/components/layout/use-latest-callback";

export type AppShellSearchOverlaySurfaceProps = {
  visible: boolean;
  activeOverlay: OverlayKey;
  label: string;
  onClose: () => void;
  commandPaletteItems: CommandPaletteItem[];
  searchOverlayProps: Omit<
    ComponentProps<typeof SearchOverlayContent>,
    "activeOverlay" | "commandPaletteItems" | "onCloseOverlay"
  >;
};

const MemoSearchOverlayContent = memo(SearchOverlayContent, sameSearchOverlayContentProps);

export function AppShellSearchOverlaySurface({
  visible,
  activeOverlay,
  label,
  onClose,
  commandPaletteItems,
  searchOverlayProps,
}: AppShellSearchOverlaySurfaceProps) {
  const onCloseOverlay = useLatestCallback(onClose);
  const onChangeQuery = useLatestCallback(searchOverlayProps.onChangeQuery);
  const onDraftQueryChange = useLatestCallback(searchOverlayProps.onDraftQueryChange);
  const onChangeSearchEverywhereScope = useLatestCallback(searchOverlayProps.onChangeSearchEverywhereScope);
  const onChangeSearchEverywhereReplaceQuery = useLatestCallback(searchOverlayProps.onChangeSearchEverywhereReplaceQuery);
  const onOpenFile = useLatestCallback(searchOverlayProps.onOpenFile);
  const onMoveQuickOpenSelection = useLatestCallback(searchOverlayProps.onMoveQuickOpenSelection);
  const onSelectQuickOpenResult = useLatestCallback(searchOverlayProps.onSelectQuickOpenResult);
  const onOpenSearchEverywhereResult = useLatestCallback(searchOverlayProps.onOpenSearchEverywhereResult);
  const onOpenSearchEverywhereCandidate = useLatestCallback(searchOverlayProps.onOpenSearchEverywhereCandidate);
  const onLoadNextSearchEverywherePage = useLatestCallback(searchOverlayProps.onLoadNextSearchEverywherePage);
  const onOpenProject = useLatestCallback(searchOverlayProps.onOpenProject);
  const onMoveSearchEverywhereSelection = useLatestCallback(searchOverlayProps.onMoveSearchEverywhereSelection);
  const onOpenSelectedSearchEverywhereResult = useLatestCallback(searchOverlayProps.onOpenSelectedSearchEverywhereResult);
  const onSelectSearchEverywhereResult = useLatestCallback(searchOverlayProps.onSelectSearchEverywhereResult);
  const onToggleSearchEverywhereCaseSensitive = useLatestCallback(searchOverlayProps.onToggleSearchEverywhereCaseSensitive);
  const onToggleSearchEverywhereWholeWord = useLatestCallback(searchOverlayProps.onToggleSearchEverywhereWholeWord);
  const onSubmitGoToLine = useLatestCallback(searchOverlayProps.onSubmitGoToLine);

  if (!visible) {
    return null;
  }

  return (
    <OverlaySurface
      activeOverlay={activeOverlay}
      label={label}
      onClose={onCloseOverlay}
      searchMode={searchOverlayProps.searchEverywhereMode}
    >
      <MemoSearchOverlayContent
        {...searchOverlayProps}
        activeOverlay={activeOverlay}
        commandPaletteItems={commandPaletteItems}
        onCloseOverlay={onCloseOverlay}
        onChangeQuery={onChangeQuery}
        onDraftQueryChange={onDraftQueryChange}
        onChangeSearchEverywhereScope={onChangeSearchEverywhereScope}
        onChangeSearchEverywhereReplaceQuery={onChangeSearchEverywhereReplaceQuery}
        onOpenFile={onOpenFile}
        onMoveQuickOpenSelection={onMoveQuickOpenSelection}
        onSelectQuickOpenResult={onSelectQuickOpenResult}
        onOpenSearchEverywhereResult={onOpenSearchEverywhereResult}
        onOpenSearchEverywhereCandidate={onOpenSearchEverywhereCandidate}
        onLoadNextSearchEverywherePage={onLoadNextSearchEverywherePage}
        onOpenProject={onOpenProject}
        onMoveSearchEverywhereSelection={onMoveSearchEverywhereSelection}
        onOpenSelectedSearchEverywhereResult={onOpenSelectedSearchEverywhereResult}
        onSelectSearchEverywhereResult={onSelectSearchEverywhereResult}
        onToggleSearchEverywhereCaseSensitive={onToggleSearchEverywhereCaseSensitive}
        onToggleSearchEverywhereWholeWord={onToggleSearchEverywhereWholeWord}
        onSubmitGoToLine={onSubmitGoToLine}
      />
    </OverlaySurface>
  );
}

function sameSearchOverlayContentProps(
  previous: SearchOverlayContentProps,
  next: SearchOverlayContentProps,
) {
  if (
    previous.activeOverlay !== next.activeOverlay
    || previous.quickOpenQuery !== next.quickOpenQuery
  ) return false;

  if (next.activeOverlay === "commandPalette") {
    return previous.commandPaletteItems === next.commandPaletteItems;
  }
  if (next.activeOverlay === "recentFiles") {
    return previous.recentFileResults === next.recentFileResults;
  }
  if (next.activeOverlay === "recentProjects") {
    return previous.recentProjectResults === next.recentProjectResults;
  }
  if (next.activeOverlay === "goToLine") {
    return true;
  }
  if (next.activeOverlay === "searchEverywhere") {
    return previous.searchSessionStore === next.searchSessionStore
      && previous.searchEverywhereOptions === next.searchEverywhereOptions
      && previous.searchEverywhereMode === next.searchEverywhereMode
      && (
        next.searchEverywhereMode !== "searchEverywhere"
        || previous.searchEverywhereScope === next.searchEverywhereScope
      )
      && (
        next.searchEverywhereMode !== "replace"
        || previous.searchEverywhereReplaceQuery === next.searchEverywhereReplaceQuery
      )
      && previous.workspacePartialNotice === next.workspacePartialNotice;
  }
  return previous.quickOpenResults === next.quickOpenResults
    && previous.quickOpenSelectedIndex === next.quickOpenSelectedIndex
    && previous.workspacePartialNotice === next.workspacePartialNotice;
}
