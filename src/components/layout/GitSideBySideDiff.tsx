import { useMemo } from "react";
import type { DiffHunk } from "@/features/diff/unified-diff";
import { projectSideBySideRows, type DiffSideLine } from "@/features/diff/side-by-side-diff";

type GitSideBySideDiffProps = {
  hunk: DiffHunk;
  selectedIndexes: number[];
  selectable: boolean;
  onToggle: (index: number) => void;
};

export function GitSideBySideDiff({ hunk, selectedIndexes, selectable, onToggle }: GitSideBySideDiffProps) {
  const rows = useMemo(() => projectSideBySideRows(hunk), [hunk]);
  return (
    <div className="diff-split" role="table" aria-label={`Side-by-side diff ${hunk.header}`}>
      <div className="diff-split__head" role="row">
        <span role="columnheader">Before</span>
        <span role="columnheader">After</span>
      </div>
      {rows.map((row, index) => (
        <div key={`${index}:${row.left?.sourceIndex ?? "x"}:${row.right?.sourceIndex ?? "x"}`} className={`diff-split__row diff-split__row--${row.kind}`} role="row">
          <SideCell side={row.left} position="left" selectedIndexes={selectedIndexes} selectable={selectable} onToggle={onToggle} />
          <SideCell side={row.right} position="right" selectedIndexes={selectedIndexes} selectable={selectable} onToggle={onToggle} />
        </div>
      ))}
    </div>
  );
}

function SideCell({ side, position, selectedIndexes, selectable, onToggle }: {
  side: DiffSideLine | null;
  position: "left" | "right";
  selectedIndexes: number[];
  selectable: boolean;
  onToggle: (index: number) => void;
}) {
  if (!side) return <div className="diff-split__cell diff-split__cell--empty" role="cell" aria-label={`No ${position} line`} />;
  const { line, sourceIndex } = side;
  const changed = line.kind !== "context";
  const lineNumber = position === "left" ? line.oldLine : line.newLine;
  return (
    <div className={`diff-split__cell diff-split__cell--${line.kind}${selectedIndexes.includes(sourceIndex) ? " diff-split__cell--selected" : ""}`} role="cell">
      <span className="diff-split__select">
        {selectable && changed ? <input type="checkbox" aria-label={`Select ${line.kind} line ${lineNumber}`} checked={selectedIndexes.includes(sourceIndex)} onChange={() => onToggle(sourceIndex)} /> : null}
      </span>
      <span className="diff-split__number">{lineNumber ?? ""}</span>
      <code>{line.text}</code>
    </div>
  );
}
