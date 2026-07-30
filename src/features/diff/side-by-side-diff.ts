import type { DiffHunk, DiffLine } from "@/features/diff/unified-diff";

export type DiffSideLine = {
  line: DiffLine;
  sourceIndex: number;
};

export type SideBySideDiffRow = {
  kind: "context" | "changed";
  left: DiffSideLine | null;
  right: DiffSideLine | null;
};

export function projectSideBySideRows(hunk: DiffHunk): SideBySideDiffRow[] {
  const rows: SideBySideDiffRow[] = [];
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (line.kind === "context") {
      const side = { line, sourceIndex: index };
      rows.push({ kind: "context", left: side, right: side });
      index += 1;
      continue;
    }

    const removed: DiffSideLine[] = [];
    const added: DiffSideLine[] = [];
    while (index < hunk.lines.length && hunk.lines[index].kind !== "context") {
      const changed = { line: hunk.lines[index], sourceIndex: index };
      if (changed.line.kind === "removed") removed.push(changed);
      else added.push(changed);
      index += 1;
    }
    const rowCount = Math.max(removed.length, added.length);
    for (let row = 0; row < rowCount; row += 1) {
      rows.push({ kind: "changed", left: removed[row] ?? null, right: added[row] ?? null });
    }
  }
  return rows;
}
