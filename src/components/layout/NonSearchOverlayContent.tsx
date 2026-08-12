import { englishQueryInputProps } from "@/components/layout/query-input-props";
import { OverlaySurface } from "@/components/layout/OverlaySurface";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";

export type NonSearchOverlayContentProps = {
  activeOverlay: OverlayKey;
  label: string;
  query: string;
  commandPaletteItems: CommandPaletteItem[];
  recentFileResults: { path: string; title: string; relativePath: string }[];
  recentProjectResults: { path: string; name: string }[];
  onChangeQuery: (value: string) => void;
  onOpenFile: (path: string) => void;
  onOpenProject: (path: string) => void;
  onSubmitGoToLine: () => void;
  onClose: () => void;
};

export function NonSearchOverlayContent({
  activeOverlay,
  label,
  query,
  commandPaletteItems,
  recentFileResults,
  recentProjectResults,
  onChangeQuery,
  onOpenFile,
  onOpenProject,
  onSubmitGoToLine,
  onClose,
}: NonSearchOverlayContentProps) {
  if (activeOverlay === "commandPalette") {
    return (
      <OverlaySurface activeOverlay={activeOverlay} label={label} onClose={onClose}>
        <input aria-label="Find Action Query" autoFocus className="panel-input" {...englishQueryInputProps} value={query} placeholder="Type an action" onChange={(event) => onChangeQuery(event.target.value)} />
        <div className="search-results" role="list" aria-label="Find Action Results">
          {commandPaletteItems.map((item) => (
            <button key={item.id} type="button" className="search-result" onClick={() => { onClose(); item.action(); }}>
              <span>{item.label}</span>
              {item.shortcut ? <span className="search-result__shortcut" aria-hidden="true">{item.shortcut}</span> : null}
            </button>
          ))}
          {commandPaletteItems.length === 0 ? <div className="palette-empty">No actions found</div> : null}
        </div>
      </OverlaySurface>
    );
  }
  if (activeOverlay === "recentFiles") {
    return (
      <OverlaySurface activeOverlay={activeOverlay} label={label} onClose={onClose}>
        <input aria-label="Recent Files Query" autoFocus className="panel-input" {...englishQueryInputProps} value={query} placeholder="Filter recent files" onChange={(event) => onChangeQuery(event.target.value)} />
        <div className="search-results" role="list" aria-label="Recent Files Results">
          {recentFileResults.map((tab) => <button key={tab.path} type="button" className="search-result recent-file-result" onClick={() => onOpenFile(tab.path)}><span className="recent-file-result__title">{tab.title}</span><span className="recent-file-result__path">{tab.relativePath}</span></button>)}
          {recentFileResults.length === 0 ? <div className="palette-empty">No recent files</div> : null}
        </div>
      </OverlaySurface>
    );
  }
  if (activeOverlay === "recentProjects") {
    return (
      <OverlaySurface activeOverlay={activeOverlay} label={label} onClose={onClose}>
        <input aria-label="Recent Projects Query" autoFocus className="panel-input" {...englishQueryInputProps} value={query} placeholder="Filter recent projects" onChange={(event) => onChangeQuery(event.target.value)} />
        <div className="search-results" role="list" aria-label="Recent Projects Results">
          {recentProjectResults.map((project) => <button key={project.path} type="button" className="search-result" onClick={() => onOpenProject(project.path)}>{project.name}<span className="search-result__meta">{project.path}</span></button>)}
          {recentProjectResults.length === 0 ? <div className="palette-empty">No recent projects</div> : null}
        </div>
      </OverlaySurface>
    );
  }
  if (activeOverlay !== "goToLine") return null;
  return (
    <OverlaySurface activeOverlay={activeOverlay} label={label} onClose={onClose}>
      <input aria-label="Go to Line Query" autoFocus className="panel-input" {...englishQueryInputProps} value={query} placeholder="Line or line:column" onChange={(event) => onChangeQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onSubmitGoToLine(); } }} />
      <div className="search-results" role="list" aria-label="Go to Line Results"><button type="button" className="search-result" onClick={onSubmitGoToLine}>{query.trim() ? `Go to ${query.trim()}` : "Enter a line number"}</button></div>
    </OverlaySurface>
  );
}
