import type { LeftToolKey } from "@/components/layout/shell-state";

type LeftToolRailProps = {
  activeTool: LeftToolKey;
  onSelectTool: (tool: LeftToolKey) => void;
};

const toolLabels: Record<LeftToolKey, string> = {
  project: "Project",
  search: "Search",
  git: "Git",
  problems: "Problems"
};

const toolIcons: Record<LeftToolKey, string> = {
  project: "left-tool-rail__icon--project",
  search: "left-tool-rail__icon--search",
  git: "left-tool-rail__icon--git",
  problems: "left-tool-rail__icon--problems",
};

export function LeftToolRail({ activeTool, onSelectTool }: LeftToolRailProps) {
  return (
    <nav className="left-tool-rail" aria-label="Primary Tool Window Rail">
      {(Object.keys(toolLabels) as LeftToolKey[]).map((tool) => (
        <button
          key={tool}
          type="button"
          className={`left-tool-rail__button${activeTool === tool ? " left-tool-rail__button--active" : ""}`}
          aria-pressed={activeTool === tool}
          aria-label={toolLabels[tool]}
          title={toolLabels[tool]}
          onClick={() => onSelectTool(tool)}
        >
          <span className={`left-tool-rail__icon ${toolIcons[tool]}`} aria-hidden="true" />
          <span className="visually-hidden">{toolLabels[tool]}</span>
        </button>
      ))}
    </nav>
  );
}
