import { describe, expect, it } from "vitest";
import { projectSideBySideRows } from "@/features/diff/side-by-side-diff";
import { parseUnifiedDiff } from "@/features/diff/unified-diff";

describe("side-by-side diff projection", () => {
  it("aligns replacement blocks while preserving source line indexes", () => {
    const hunk = parseUnifiedDiff(`diff --git a/main.ets b/main.ets
--- a/main.ets
+++ b/main.ets
@@ -1,4 +1,4 @@
 keep
-old one
-old two
+new one
+new two
 tail`).at(0)!.hunks[0];

    const rows = projectSideBySideRows(hunk);

    expect(rows.map((row) => [row.left?.line.text ?? null, row.right?.line.text ?? null])).toEqual([
      ["keep", "keep"],
      ["old one", "new one"],
      ["old two", "new two"],
      ["tail", "tail"],
    ]);
    expect(rows[1].left?.sourceIndex).toBe(1);
    expect(rows[1].right?.sourceIndex).toBe(3);
  });

  it("uses blank counterparts for pure insertions and deletions", () => {
    const hunk = parseUnifiedDiff(`diff --git a/main.ets b/main.ets
--- a/main.ets
+++ b/main.ets
@@ -1,2 +1,2 @@
-removed
+added
+extra`).at(0)!.hunks[0];
    const rows = projectSideBySideRows(hunk);
    expect(rows).toHaveLength(2);
    expect(rows[1].left).toBeNull();
    expect(rows[1].right?.line.text).toBe("extra");
  });
});
