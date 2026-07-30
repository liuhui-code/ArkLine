import { buildPartialPatchBody, changedLineIndexes } from "@/features/diff/partial-patch";
import { parseUnifiedDiff } from "@/features/diff/unified-diff";

describe("unified diff parser", () => {
  it("parses files and hunks", () => {
    const files = parseUnifiedDiff(`diff --git a/main.ets b/main.ets
--- a/main.ets
+++ b/main.ets
@@ -1,2 +1,2 @@
-old
+new
 keep`);

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("main.ets");
    expect(files[0]?.hunks[0]?.lines.map((line) => line.kind)).toEqual([
      "removed",
      "added",
      "context",
    ]);
    expect(files[0]?.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 2, newStart: 1, newCount: 2 });
    expect(files[0]?.hunks[0]?.lines).toMatchObject([
      { oldLine: 1, newLine: null },
      { oldLine: null, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
  });

  it("marks binary patches without inventing hunks", () => {
    const files = parseUnifiedDiff(`diff --git a/a.png b/a.png
Binary files a/a.png and b/a.png differ`);
    expect(files[0]).toMatchObject({ path: "a.png", binary: true, hunks: [] });
  });

  it("builds forward and reverse patches for selected replacement lines", () => {
    const hunk = parseUnifiedDiff(`diff --git a/main.ets b/main.ets
--- a/main.ets
+++ b/main.ets
@@ -1,3 +1,4 @@
 keep
-old
+new
+extra
 tail`)[0]!.hunks[0]!;

    expect(changedLineIndexes(hunk)).toEqual([1, 2, 3]);
    expect(buildPartialPatchBody(hunk, new Set([2]), "forward")).toBe(
      "@@ -1,3 +1,4 @@\n keep\n old\n+new\n tail\n",
    );
    expect(buildPartialPatchBody(hunk, new Set([2]), "reverse")).toBe(
      "@@ -1,4 +1,3 @@\n keep\n-new\n extra\n tail\n",
    );
  });

  it("reorders a full replacement when building the reverse patch", () => {
    const hunk = parseUnifiedDiff(`diff --git a/main.ets b/main.ets
--- a/main.ets
+++ b/main.ets
@@ -1 +1 @@
-before
+after`)[0]!.hunks[0]!;

    expect(buildPartialPatchBody(hunk, new Set([0, 1]), "reverse")).toBe(
      "@@ -1,1 +1,1 @@\n-after\n+before\n",
    );
  });

  it("preserves no-newline markers without counting them as content", () => {
    const hunk = parseUnifiedDiff(`diff --git a/main.ets b/main.ets
--- a/main.ets
+++ b/main.ets
@@ -1 +1 @@
-before
\\ No newline at end of file
+after
\\ No newline at end of file`)[0]!.hunks[0]!;

    expect(buildPartialPatchBody(hunk, new Set([0, 1]), "forward")).toBe(
      "@@ -1,1 +1,1 @@\n-before\n\\ No newline at end of file\n+after\n\\ No newline at end of file\n",
    );
  });
});
