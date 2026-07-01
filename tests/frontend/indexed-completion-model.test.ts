import {
  candidateToCompletionItem,
  candidateToCurrentClassMethod,
  keywordCompletionItems,
  mergeCompletionItems,
} from "@/components/layout/indexed-completion-model";
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    id: "symbol:/workspace/src/main.ets:4:3",
    source: "symbol",
    kind: "method",
    title: "build",
    subtitle: "/workspace/src/main.ets",
    path: "/workspace/src/main.ets",
    line: 4,
    column: 3,
    score: 0,
    freshness: "ready",
    ...overrides,
  };
}

describe("indexed completion model", () => {
  it("converts indexed methods into callable completion items with definition targets", () => {
    expect(candidateToCompletionItem(candidate(), "workspace")).toEqual({
      label: "build()",
      detail: "Indexed method",
      kind: "method",
      insertText: "build()",
      filterText: "build",
      source: "workspace",
      definitionTarget: { path: "/workspace/src/main.ets", line: 4, column: 3 },
    });
  });

  it("marks current-file candidates so presentation can rank them ahead of workspace symbols", () => {
    expect(candidateToCompletionItem(candidate({ kind: "class", title: "Index" }), "currentFile")).toMatchObject({
      label: "Index",
      detail: "Current file class",
      kind: "class",
      filterText: "Index",
    });
  });

  it("maps SDK API candidates to SDK completion source and keeps target location", () => {
    expect(candidateToCompletionItem(candidate({
      source: "api",
      kind: "method",
      title: "width",
      path: "/sdk/ets/component/common.d.ts",
      line: 20927,
      column: 5,
    }))).toMatchObject({
      label: "width()",
      detail: "Indexed API method",
      source: "sdk",
      definitionTarget: { path: "/sdk/ets/component/common.d.ts", line: 20927, column: 5 },
    });
  });

  it("only offers ArkTS keywords after a meaningful prefix", () => {
    expect(keywordCompletionItems("")).toEqual([]);
    expect(keywordCompletionItems("p")).toEqual([]);
    expect(keywordCompletionItems("pri").map((item) => item.label)).toEqual(["private"]);
    expect(keywordCompletionItems("pu").map((item) => item.label)).toEqual(["public"]);
  });

  it("keeps earlier completion groups authoritative while removing duplicate labels and kinds", () => {
    const semantic: LanguageCompletionItem[] = [
      { label: "build()", detail: "Semantic method", kind: "method", source: "arkts" },
    ];
    const indexed: LanguageCompletionItem[] = [
      { label: "build()", detail: "Indexed method", kind: "method", source: "workspace" },
      { label: "build", detail: "Indexed property", kind: "property", source: "workspace" },
    ];

    expect(mergeCompletionItems(semantic, indexed)).toEqual([
      { label: "build()", detail: "Semantic method", kind: "method", source: "arkts" },
      { label: "build", detail: "Indexed property", kind: "property", source: "workspace" },
    ]);
  });

  it("converts indexed file symbols into current-class method entries", () => {
    expect(candidateToCurrentClassMethod(candidate())).toEqual({
      name: "build",
      signature: "build()",
      line: 4,
      column: 3,
    });
  });
});
