import { describe, expect, it } from "vitest";
import { countConflictMarkers, findConflictMarkerBlocks, resolveConflictMarker } from "@/features/git/git-conflict-markers";

const conflictOpen = "<".repeat(7);
const conflictMiddle = "=".repeat(7);
const conflictClose = ">".repeat(7);

const twoConflicts = `before
${conflictOpen} HEAD
current one
${conflictMiddle}
incoming one
${conflictClose} feature
middle
${conflictOpen} HEAD
current two
${conflictMiddle}
incoming two
${conflictClose} feature
after
`;

describe("Git conflict markers", () => {
  it("finds complete conflict blocks and reports unresolved openings", () => {
    const blocks = findConflictMarkerBlocks(twoConflicts);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ current: "current one\n", incoming: "incoming one\n" });
    expect(countConflictMarkers(twoConflicts)).toBe(2);
  });

  it("resolves one conflict without changing the remaining block", () => {
    const blocks = findConflictMarkerBlocks(twoConflicts);
    const resolved = resolveConflictMarker(twoConflicts, blocks[0], "both");
    expect(resolved).toContain("current one\nincoming one\n");
    expect(resolved).toContain(`${conflictOpen} HEAD\ncurrent two`);
    expect(countConflictMarkers(resolved)).toBe(1);
  });
});
