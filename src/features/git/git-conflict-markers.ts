export type GitConflictMarkerBlock = {
  start: number;
  end: number;
  current: string;
  incoming: string;
};

export type GitConflictMarkerChoice = "current" | "incoming" | "both";

export function findConflictMarkerBlocks(content: string): GitConflictMarkerBlock[] {
  const pattern = /^<<<<<<<[^\r\n]*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>>[^\r\n]*(?:\r?\n|$)/gm;
  return [...content.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    current: match[1],
    incoming: match[2],
  }));
}

export function countConflictMarkers(content: string) {
  return content.match(/^<<<<<<<(?: |$)/gm)?.length ?? 0;
}

export function resolveConflictMarker(
  content: string,
  block: GitConflictMarkerBlock,
  choice: GitConflictMarkerChoice,
) {
  const replacement = choice === "current"
    ? block.current
    : choice === "incoming"
      ? block.incoming
      : joinVersions(block.current, block.incoming);
  return `${content.slice(0, block.start)}${replacement}${content.slice(block.end)}`;
}

function joinVersions(current: string, incoming: string) {
  return `${current}${current && incoming && !current.endsWith("\n") ? "\n" : ""}${incoming}`;
}
