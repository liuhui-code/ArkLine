import type { DiffHunk, DiffLine } from "@/features/diff/unified-diff";

export type PartialPatchDirection = "forward" | "reverse";

export function changedLineIndexes(hunk: DiffHunk) {
  return hunk.lines.flatMap((line, index) => line.kind === "context" ? [] : [index]);
}

export function buildPartialPatchBody(
  hunk: DiffHunk,
  selectedIndexes: ReadonlySet<number>,
  direction: PartialPatchDirection,
) {
  const selected = changedLineIndexes(hunk).filter((index) => selectedIndexes.has(index));
  if (selected.length === 0) throw new Error("Select at least one changed line");
  const rendered = renderLines(hunk.lines, selectedIndexes, direction);
  const sourceCount = rendered.filter((line) => !line.startsWith("+") && !line.startsWith("\\")).length;
  const targetCount = rendered.filter((line) => !line.startsWith("-") && !line.startsWith("\\")).length;
  const sourceStart = direction === "forward" ? hunk.oldStart : hunk.newStart;
  const targetStart = direction === "forward" ? hunk.newStart : hunk.oldStart;
  return `@@ -${sourceStart},${sourceCount} +${targetStart},${targetCount} @@\n${rendered.join("\n")}\n`;
}

function renderLines(
  lines: DiffLine[],
  selected: ReadonlySet<number>,
  direction: PartialPatchDirection,
) {
  const output: string[] = [];
  let block: Array<{ line: DiffLine; index: number }> = [];
  const flush = () => {
    if (!block.length) return;
    const firstKind = direction === "forward" ? "removed" : "added";
    appendKind(output, block, firstKind, selected, direction);
    appendKind(output, block, firstKind === "removed" ? "added" : "removed", selected, direction);
    block = [];
  };
  lines.forEach((line, index) => {
    if (line.kind === "context") {
      flush();
      appendLine(output, line, " ");
    } else {
      block.push({ line, index });
    }
  });
  flush();
  return output;
}

function appendKind(
  output: string[],
  block: Array<{ line: DiffLine; index: number }>,
  kind: "added" | "removed",
  selected: ReadonlySet<number>,
  direction: PartialPatchDirection,
) {
  block.filter((item) => item.line.kind === kind).forEach(({ line, index }) => {
    const isSelected = selected.has(index);
    const prefix = patchPrefix(kind, isSelected, direction);
    if (prefix) appendLine(output, line, prefix);
  });
}

function appendLine(output: string[], line: DiffLine, prefix: string) {
  output.push(`${prefix}${line.text}`);
  if (line.noNewline) output.push("\\ No newline at end of file");
}

function patchPrefix(
  kind: "added" | "removed",
  selected: boolean,
  direction: PartialPatchDirection,
) {
  if (direction === "forward") {
    if (kind === "removed") return selected ? "-" : " ";
    return selected ? "+" : null;
  }
  if (kind === "added") return selected ? "-" : " ";
  return selected ? "+" : null;
}
