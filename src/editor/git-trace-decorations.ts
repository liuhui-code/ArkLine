import type { Extension } from "@codemirror/state";
import { gutter, GutterMarker, type BlockInfo } from "@codemirror/view";
import type { GitBlameAttribution } from "@/features/git/git-trace-model";

class GitTraceMarker extends GutterMarker {
  constructor(
    private readonly label: string,
    private readonly lineNumber: number,
    private readonly selected: boolean,
  ) {
    super();
  }

  eq(other: GitTraceMarker) {
    return other.label === this.label && other.lineNumber === this.lineNumber && other.selected === this.selected;
  }

  toDOM() {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `cm-git-trace-marker${this.selected ? " cm-git-trace-marker--active" : ""}`;
    element.textContent = this.label;
    element.setAttribute("aria-label", `Git Trace Line ${this.lineNumber} ${this.label}`);
    return element;
  }
}

type GitTraceGutterOptions = {
  blameAttributions: GitBlameAttribution[];
  selectedLine: number | null;
  onSelectLine?: (line: number) => void;
};

export function createGitTraceGutter({
  blameAttributions,
  selectedLine,
  onSelectLine,
}: GitTraceGutterOptions): Extension {
  const blameByLine = new Map(blameAttributions.map((entry) => [entry.bufferLine, entry]));

  return gutter({
    class: "cm-git-trace-gutter",
    lineMarker(view, block: BlockInfo) {
      const lineNumber = view.state.doc.lineAt(block.from).number;
      const blame = blameByLine.get(lineNumber);
      if (!blame) {
        return null;
      }

      return new GitTraceMarker(buildBlameLabel(blame), lineNumber, selectedLine === lineNumber);
    },
    domEventHandlers: {
      mousedown(view, block, event) {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.closest(".cm-git-trace-marker")) {
          return false;
        }

        event.preventDefault();
        onSelectLine?.(view.state.doc.lineAt(block.from).number);
        return true;
      },
    },
  });
}

function buildBlameLabel(blame: GitBlameAttribution) {
  if (blame.status === "added") {
    return "Uncommitted";
  }

  if (blame.status === "modified") {
    return `Modified · ${blame.originalAuthor ?? blame.author ?? "Unknown"}`;
  }

  return `${blame.author ?? "Unknown"} ${blame.relativeTime ?? ""} ${blame.summary ?? ""}`.trim();
}
