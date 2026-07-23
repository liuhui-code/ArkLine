import { memo, type MouseEvent as ReactMouseEvent } from "react";
import type { ProjectTreeEntry } from "@/components/layout/project-tree-model";

type ProjectTreeRowProps = {
  entry: ProjectTreeEntry;
  active: boolean;
  selected: boolean;
  onActivate: (entry: ProjectTreeEntry) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, entry: ProjectTreeEntry) => void;
  registerFileRow: (path: string, node: HTMLButtonElement | null) => void;
};

function ProjectTreeRowComponent({
  entry,
  active,
  selected,
  onActivate,
  onContextMenu,
  registerFileRow,
}: ProjectTreeRowProps) {
  const paddingLeft = `${entry.depth * 16 + 8}px`;
  if (entry.kind === "loading") {
    return (
      <div
        className="project-tree__row project-tree__row--loading"
        style={{ paddingLeft }}
        role="status"
        aria-live="polite"
      >
        <span className="project-tree__caret" aria-hidden="true" />
        <span className="project-tree__icon project-tree__icon--file" aria-hidden="true" />
        <span className="project-tree__label">{entry.label}</span>
      </div>
    );
  }

  if (entry.kind === "directory") {
    return (
      <button
        type="button"
        className={`project-tree__row project-tree__row--directory${selected ? " project-tree__row--active" : ""}`}
        style={{ paddingLeft }}
        aria-expanded={entry.expanded ? "true" : "false"}
        aria-selected={selected ? "true" : undefined}
        onClick={() => onActivate(entry)}
        onContextMenu={(event) => onContextMenu(event, entry)}
      >
        <span className="project-tree__caret" aria-hidden="true">
          {entry.expanded ? "▾" : "▸"}
        </span>
        <span className="project-tree__icon project-tree__icon--directory" aria-hidden="true" />
        <span className="project-tree__label">{entry.label}</span>
      </button>
    );
  }

  return (
    <button
      ref={(node) => registerFileRow(entry.path, node)}
      type="button"
      className={`project-tree__row project-tree__row--file${active || selected ? " project-tree__row--active" : ""}`}
      style={{ paddingLeft }}
      title={entry.path}
      aria-current={active ? "true" : undefined}
      aria-selected={selected ? "true" : undefined}
      onClick={() => onActivate(entry)}
      onContextMenu={(event) => onContextMenu(event, entry)}
    >
      <span className="project-tree__caret" aria-hidden="true" />
      <span className="project-tree__icon project-tree__icon--file" aria-hidden="true" />
      <span className="project-tree__label">{entry.label}</span>
    </button>
  );
}

export const ProjectTreeRow = memo(ProjectTreeRowComponent);
