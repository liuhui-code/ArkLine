import type { OverlayKey } from "@/components/layout/shell-state";

type CommandPaletteItem = {
  id: string;
  label: string;
  action: () => void;
};

type SearchOverlayContentProps = {
  activeOverlay: OverlayKey;
  commandPaletteItems: CommandPaletteItem[];
  completionResults: { label: string; detail: string; kind: string }[];
  quickOpenQuery: string;
  quickOpenResults: { path: string }[];
  recentFileResults: { path: string }[];
  recentProjectResults: { path: string; name: string }[];
  searchEverywhereResults: { path: string }[];
  onChangeQuery: (value: string) => void;
  onOpenFile: (path: string) => void;
  onOpenProject: (path: string) => void;
  onInsertCompletion: (label: string) => void;
  onSubmitGoToLine: () => void;
  onCloseOverlay: () => void;
};

export function SearchOverlayContent({
  activeOverlay,
  commandPaletteItems,
  completionResults,
  quickOpenQuery,
  quickOpenResults,
  recentFileResults,
  recentProjectResults,
  searchEverywhereResults,
  onChangeQuery,
  onOpenFile,
  onOpenProject,
  onInsertCompletion,
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
          autoFocus
          className="panel-input"
          value={quickOpenQuery}
          placeholder="Filter completion items"
          onChange={(event) => onChangeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && completionResults[0]) {
              onInsertCompletion(completionResults[0].label);
            }
          }}
        />
        <div className="search-results" role="list" aria-label="Completion Results">
          {completionResults.map((item) => (
            <button
              key={`${item.kind}:${item.label}`}
              type="button"
              className="search-result"
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

  const queryLabel = activeOverlay === "searchEverywhere" ? "Search Everywhere Query" : "Quick Open Query";
  const resultsLabel = activeOverlay === "searchEverywhere" ? "Search Everywhere Results" : "Quick Open Results";
  const placeholder =
    activeOverlay === "searchEverywhere" ? "Search files across the workspace" : "Type a filename or path";
  const results = activeOverlay === "searchEverywhere" ? searchEverywhereResults : quickOpenResults;

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
