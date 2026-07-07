import type { OverlayKey } from "@/components/layout/shell-state";
import { englishQueryInputProps } from "@/components/layout/query-input-props";
import { SearchEverywherePanel, type SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";
import type {
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";

type SearchOverlayContentProps = {
  activeOverlay: OverlayKey;
  commandPaletteItems: CommandPaletteItem[];
  quickOpenQuery: string;
  quickOpenResults: { path: string }[];
  recentFileResults: { path: string }[];
  recentProjectResults: { path: string; name: string }[];
  searchEverywhereOptions: WorkspaceTextSearchOptions;
  searchEverywhereMode: SearchEverywhereMode;
  searchEverywhereScope: WorkspaceIndexQueryScope;
  searchEverywhereReplaceQuery: string;
  searchEverywhereResult: WorkspaceTextSearchResult;
  searchEverywhereCandidates: SearchCandidate[];
  searchEverywhereSelectedIndex: number;
  searchEverywherePreviewContent: string | null;
  workspacePartialNotice: string | null;
  onChangeQuery: (value: string) => void;
  onChangeSearchEverywhereScope: (scope: WorkspaceIndexQueryScope) => void;
  onChangeSearchEverywhereReplaceQuery: (value: string) => void;
  onOpenFile: (path: string) => void;
  onOpenSearchEverywhereResult: (result: WorkspaceTextSearchMatch) => void;
  onOpenSearchEverywhereCandidate: (candidate: SearchCandidate) => void;
  onOpenProject: (path: string) => void;
  onMoveSearchEverywhereSelection: (direction: 1 | -1) => void;
  onOpenSelectedSearchEverywhereResult: () => void;
  onSelectSearchEverywhereResult: (index: number) => void;
  onToggleSearchEverywhereCaseSensitive: () => void;
  onToggleSearchEverywhereWholeWord: () => void;
  onSubmitGoToLine: () => void;
  onCloseOverlay: () => void;
};

export function SearchOverlayContent({
  activeOverlay,
  commandPaletteItems,
  quickOpenQuery,
  quickOpenResults,
  recentFileResults,
  recentProjectResults,
  searchEverywhereOptions,
  searchEverywhereMode,
  searchEverywhereScope,
  searchEverywhereReplaceQuery,
  searchEverywhereResult,
  searchEverywhereCandidates,
  searchEverywhereSelectedIndex,
  searchEverywherePreviewContent,
  workspacePartialNotice,
  onChangeQuery,
  onChangeSearchEverywhereScope,
  onChangeSearchEverywhereReplaceQuery,
  onOpenFile,
  onOpenSearchEverywhereResult,
  onOpenSearchEverywhereCandidate,
  onOpenProject,
  onMoveSearchEverywhereSelection,
  onOpenSelectedSearchEverywhereResult,
  onSelectSearchEverywhereResult,
  onToggleSearchEverywhereCaseSensitive,
  onToggleSearchEverywhereWholeWord,
  onSubmitGoToLine,
  onCloseOverlay,
}: SearchOverlayContentProps) {
  if (activeOverlay === "commandPalette") {
    return (
      <>
        <input
          aria-label="Find Action Query"
          autoFocus
          className="panel-input"
          {...englishQueryInputProps}
          value={quickOpenQuery}
          placeholder="Type an action"
          onChange={(event) => onChangeQuery(event.target.value)}
        />
        <div className="search-results" role="list" aria-label="Find Action Results">
          {commandPaletteItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="search-result"
              onClick={() => {
                onCloseOverlay();
                item.action();
              }}
            >
              <span>{item.label}</span>
              {item.shortcut ? <span className="search-result__shortcut" aria-hidden="true">{item.shortcut}</span> : null}
            </button>
          ))}
          {commandPaletteItems.length === 0 ? <div className="palette-empty">No actions found</div> : null}
        </div>
      </>
    );
  }

  if (activeOverlay === "recentFiles") {
    return (
      <>
        <input
          aria-label="Recent Files Query"
          autoFocus
          className="panel-input"
          {...englishQueryInputProps}
          value={quickOpenQuery}
          placeholder="Filter recent files"
          onChange={(event) => onChangeQuery(event.target.value)}
        />
        <div className="search-results" role="list" aria-label="Recent Files Results">
          {recentFileResults.map((tab) => (
            <button
              key={tab.path}
              type="button"
              className="search-result"
              onClick={() => onOpenFile(tab.path)}
            >
              {tab.path}
            </button>
          ))}
          {recentFileResults.length === 0 ? <div className="palette-empty">No recent files</div> : null}
        </div>
      </>
    );
  }

  if (activeOverlay === "recentProjects") {
    return (
      <>
        <input
          aria-label="Recent Projects Query"
          autoFocus
          className="panel-input"
          {...englishQueryInputProps}
          value={quickOpenQuery}
          placeholder="Filter recent projects"
          onChange={(event) => onChangeQuery(event.target.value)}
        />
        <div className="search-results" role="list" aria-label="Recent Projects Results">
          {recentProjectResults.map((project) => (
            <button
              key={project.path}
              type="button"
              className="search-result"
              onClick={() => onOpenProject(project.path)}
            >
              {project.name}
              <span className="search-result__meta">{project.path}</span>
            </button>
          ))}
          {recentProjectResults.length === 0 ? <div className="palette-empty">No recent projects</div> : null}
        </div>
      </>
    );
  }

  if (activeOverlay === "goToLine") {
    return (
      <>
        <input
          aria-label="Go to Line Query"
          autoFocus
          className="panel-input"
          {...englishQueryInputProps}
          value={quickOpenQuery}
          placeholder="Line or line:column"
          onChange={(event) => onChangeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSubmitGoToLine();
            }
          }}
        />
        <div className="search-results" role="list" aria-label="Go to Line Results">
          <button
            type="button"
            className="search-result"
            onClick={onSubmitGoToLine}
          >
            {quickOpenQuery.trim() ? `Go to ${quickOpenQuery.trim()}` : "Enter a line number"}
          </button>
        </div>
      </>
    );
  }

  if (activeOverlay === "searchEverywhere") {
    return (
      <SearchEverywherePanel
        mode={searchEverywhereMode}
        scope={searchEverywhereScope}
        options={searchEverywhereOptions}
        query={quickOpenQuery}
        replaceQuery={searchEverywhereReplaceQuery}
        result={searchEverywhereResult}
        candidates={searchEverywhereCandidates}
        selectedIndex={searchEverywhereSelectedIndex}
        selectedPreviewContent={searchEverywherePreviewContent}
        partialNotice={workspacePartialNotice}
        onChangeQuery={onChangeQuery}
        onChangeScope={onChangeSearchEverywhereScope}
        onChangeReplaceQuery={onChangeSearchEverywhereReplaceQuery}
        onMoveSelection={onMoveSearchEverywhereSelection}
        onOpenSelected={onOpenSelectedSearchEverywhereResult}
        onSelectResult={onSelectSearchEverywhereResult}
        onOpenResult={onOpenSearchEverywhereResult}
        onOpenCandidate={onOpenSearchEverywhereCandidate}
        onToggleCaseSensitive={onToggleSearchEverywhereCaseSensitive}
        onToggleWholeWord={onToggleSearchEverywhereWholeWord}
        onCloseOverlay={onCloseOverlay}
      />
    );
  }

  const queryLabel = "Quick Open Query";
  const resultsLabel = "Quick Open Results";
  const placeholder = "Type a filename or path";
  const results = quickOpenResults;

  return (
    <>
      <input
        aria-label={queryLabel}
        autoFocus
        className="panel-input"
        {...englishQueryInputProps}
        value={quickOpenQuery}
        placeholder={placeholder}
        onChange={(event) => onChangeQuery(event.target.value)}
      />
      {workspacePartialNotice ? <div className="palette-empty" role="status">{workspacePartialNotice}</div> : null}
      <div className="search-results" role="list" aria-label={resultsLabel}>
        {results.map((result) => (
          <button
            key={result.path}
            type="button"
            className="search-result"
            onClick={() => onOpenFile(result.path)}
          >
            {result.path}
          </button>
        ))}
        {results.length === 0 ? <div className="palette-empty">No files found</div> : null}
      </div>
    </>
  );
}
