import { rankPaths } from "@/features/search/fuzzy-matcher";

describe("fuzzy path matching", () => {
  const paths = [
    "entry/src/main/ets/pages/Index.ets",
    "entry/src/main/ets/components/IndexCard.ets",
    "tests/index.test.ts",
  ];

  it("prefers filename and path-segment matches", () => {
    expect(rankPaths(paths, "index").map((match) => match.path)).toEqual([
      "entry/src/main/ets/pages/Index.ets",
      "tests/index.test.ts",
      "entry/src/main/ets/components/IndexCard.ets",
    ]);
  });

  it("supports ordered non-contiguous characters", () => {
    expect(rankPaths(paths, "icard")[0]?.path).toContain("IndexCard.ets");
  });

  it("returns a bounded list for an empty query", () => {
    expect(rankPaths(paths, "", 2)).toHaveLength(2);
  });
});
