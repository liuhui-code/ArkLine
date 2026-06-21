import {
  collectFallbackCompletions,
  collectFallbackDocumentSymbols,
} from "@/features/workspace/fallback-symbols";

describe("fallback semantic symbols", () => {
  it("builds a document outline from ArkTS declarations", () => {
    const symbols = collectFallbackDocumentSymbols("struct Index {}\nfunction build() {}");

    expect(symbols).toEqual([
      { name: "Index", kind: "struct", line: 1, column: 8 },
      { name: "build", kind: "function", line: 2, column: 10 },
    ]);
  });

  it("builds stable ArkTS fallback completions", () => {
    const items = collectFallbackCompletions("@Entry\n@Component\nstruct Index {}\nfunction submit() {}");

    expect(items).toEqual([
      { label: "@Entry", detail: "ArkTS decorator", kind: "keyword" },
      { label: "@Component", detail: "ArkTS decorator", kind: "keyword" },
      { label: "build()", detail: "Component lifecycle method", kind: "method" },
      { label: "submit()", detail: "Fallback function", kind: "function" },
    ]);
  });
});
