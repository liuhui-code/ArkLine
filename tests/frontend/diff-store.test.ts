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
  });

  it("marks binary patches without inventing hunks", () => {
    const files = parseUnifiedDiff(`diff --git a/a.png b/a.png
Binary files a/a.png and b/a.png differ`);
    expect(files[0]).toMatchObject({ path: "a.png", binary: true, hunks: [] });
  });
});
