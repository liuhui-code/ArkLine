import type { OverlayKey } from "@/components/layout/shell-state";
import { SearchEverywherePanel } from "@/components/layout/SearchEverywherePanel";
import type {
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";

type CommandPaletteItem = {
  id: string;
  label: string;
  action: () => void;
};

type SearchOverlayContentProps = {
  activeOverlay: OverlayKey;
  commandPaletteItems: CommandPaletteItem[];
  completionResults: { label: string; detail: string; kind: string }[];
  completionSelectedIndex?: number;
  quickOpenQuery: string;
  quickOpenResults: { path: string }[];
  recentFileResults: { path: string }[];
  recentProjectResults: { path: string; name: string }[];
  searchEverywhereOptions: WorkspaceTextSearchOptions;
  searchEverywhereResult: WorkspaceTextSearchResult;
  searchEverywhereSelectedIndex: number;
  onChangeQuery: (value: string) => void;
  onOpenFile: (path: string) => void;
  onOpenSearchEverywhereResult: (result: WorkspaceTextSearchMatch) => void;
  onOpenProject: (path: string) => void;
  onInsertCompletion: (label: string) => void;
  onMoveCompletionSelection?: (direction: 1 | -1) => void;
  onMoveSearchEverywhereSelection: (direction: 1 | -1) => void;
  onOpenSelectedSearchEverywhereResult: () => void;
  onSelectSearchEverywhereResult: (index: number) => void;
  onToggleSearchEverywhereCaseSensitive: () => void;
  onToggleSearchEverywhereWholeWord: () => void;
  onAcceptSelectedCompletion?: () => void;
  onSubmitGoToLine: () => void;
  onCloseOverlay: () => void;
  completionAutoFocus?: boolean;
};

export function SearchOverlayContent({
  activeOverlay,
  commandPaletteItems,
  completionResults,
  completionSelectedIndex = 0,
  quickOpenQuery,
  quickOpenResults,
  recentFileResults,
  recentProjectResults,
  searchEverywhereOptions,
  searchEverywhereResult,
  searchEverywhereSelectedIndex,
  onChangeQuery,
  onOpenFile,
  onOpenSearchEverywhereResult,
  onOpenProject,
  onInsertCompletion,
  onMoveCompletionSelection,
  onMoveSearchEverywhereSelection,
  onOpenSelectedSearchEverywhereResult,
  onSelectSearchEverywhereResult,
  onToggleSearchEverywhereCaseSensitive,
  onToggleSearchEverywhereWholeWord,
  onAcceptSelectedCompletion,
  onSubmitGoToLine,
  onCloseOverlay,
  completionAutoFocus = true,
}: SearchOverlayContentProps) {
  if (activeOverlay === "commandPalette") {
    return (
      <>
        <input
          aria-label="Find Action Query"
          autoFocus
          className="panel-input"
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
              {item.label}
            </button>
          ))}
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

  if (activeOverlay === "completion") {
    return (
      <>
        <input
          aria-label="Completion Query"
          autoFocus={completionAutoFocus}
          className="panel-input"
          value={quickOpenQuery}
          placeholder="Filter completion items"
          onChange={(event) => onChangeQuery(event.target.value)}
          onKeyDown={(event) => {
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && onMoveCompletionSelection) {
              event.preventDefault();
              onMoveCompletionSelection(event.key === "ArrowDown" ? 1 : -1);
            }
            if ((event.key === "Enter" || event.key === "Tab") && completionResults[0]) {
              event.preventDefault();
              onAcceptSelectedCompletion?.();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCloseOverlay();
            }
          }}
        />
        <div className="search-results" role="list" aria-label="Completion Results">
          {completionResults.map((item, index) => (
            <button
              key={`${item.kind}:${item.label}`}
              type="button"
              className={`search-result${index === completionSelectedIndex ? " search-result--selected" : ""}`}
              aria-selected={index === completionSelectedIndex}
              onClick={() => onInsertCompletion(item.label)}
            >
              {item.label}
              <span className="search-result__meta">{item.detail}</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  if (activeOverlay === "searchEverywhere") {
    return (
      <SearchEverywherePanel
        options={searchEverywhereOptions}
        query={quickOpenQuery}
        result={searchEverywhereResult}
        selectedIndex={searchEverywhereSelectedIndex}
        onChangeQuery={onChangeQuery}
        onMoveSelection={onMoveSearchEverywhereSelection}
        onOpenSelected={onOpenSelectedSearchEverywhereResult}
        onSelectResult={onSelectSearchEverywhereResult}
        onOpenResult={onOpenSearchEverywhereResult}
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
        value={quickOpenQuery}
        placeholder={placeholder}
        onChange={(event) => onChangeQuery(event.target.value)}
      />
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
      </div>
    </>
  );
}
