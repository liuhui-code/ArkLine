import {
  normalizeCompletionItems,
  rankCompletionItems,
  type CompletionContext,
} from "@/components/layout/completion-model";
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";

const baseContext: CompletionContext = {
  prefix: "",
  lineTextBeforeCursor: "",
  trigger: "manual",
};

describe("completion presentation model", () => {
  it("normalizes backend completion items into source-aware presentation items", () => {
    const backendItems: LanguageCompletionItem[] = [
      { label: "Column()", detail: "ArkUI component", kind: "class" },
      { label: "submit()", detail: "Workspace symbol", kind: "function" },
    ];

    const items = normalizeCompletionItems(backendItems, {
      ...baseContext,
      prefix: "Co",
      lineTextBeforeCursor: "Co",
    });

    expect(items).toEqual([
      {
        id: "0:arkuiSdk:component:Column()",
        label: "Column()",
        insertText: "Column()",
        filterText: "Column()",
        detail: "ArkUI component",
        kind: "component",
        kindLabel: "Component",
        source: "arkuiSdk",
        sourceLabel: "ArkUI SDK",
        commitCharacters: [],
        replacementPrefix: "Co",
        original: backendItems[0],
      },
      {
        id: "1:workspace:method:submit()",
        label: "submit()",
        insertText: "submit()",
        filterText: "submit()",
        detail: "Workspace symbol",
        kind: "method",
        kindLabel: "Method",
        source: "workspace",
        sourceLabel: "Workspace",
        commitCharacters: [],
        replacementPrefix: "Co",
        original: backendItems[1],
      },
    ]);
  });

  it("keeps closer prefix matches ahead of recently accepted longer prefix matches", () => {
    const items = normalizeCompletionItems([
      { label: "button()", detail: "Workspace function", kind: "function" },
      { label: "build()", detail: "Workspace function", kind: "function" },
      { label: "rebuild()", detail: "Workspace function", kind: "function" },
    ], {
      ...baseContext,
      prefix: "bu",
      acceptedLabels: ["rebuild()", "button()"],
    });

    const rankedLabels = rankCompletionItems(items, {
      ...baseContext,
      prefix: "bu",
      acceptedLabels: ["rebuild()", "button()"],
    }).map((item) => item.label);

    expect(rankedLabels).toEqual(["build()", "button()", "rebuild()"]);
  });

  it("gives duplicate labels stable distinct presentation ids", () => {
    const items = normalizeCompletionItems([
      { label: "format()", detail: "Workspace overload string", kind: "function" },
      { label: "format()", detail: "Workspace overload number", kind: "function" },
    ], baseContext);

    expect(items.map((item) => item.id)).toEqual([
      "0:workspace:method:format()",
      "1:workspace:method:format()",
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it("prioritizes ArkUI chain modifiers after component calls", () => {
    const items = normalizeCompletionItems([
      { label: "width()", detail: "Workspace helper", kind: "function" },
      { label: "width", detail: "ArkUI modifier", kind: "property" },
      { label: "wrap()", detail: "Workspace helper", kind: "function" },
    ], {
      ...baseContext,
      prefix: "w",
      lineTextBeforeCursor: "Column().w",
    });

    const ranked = rankCompletionItems(items, {
      ...baseContext,
      prefix: "w",
      lineTextBeforeCursor: "Column().w",
      acceptedLabels: ["width()"],
    });

    expect(ranked.map((item) => `${item.source}:${item.label}`)).toEqual([
      "arkuiSdk:width",
      "workspace:wrap()",
      "workspace:width()",
    ]);
  });

  it("preserves completion protocol v2 metadata for SDK items", () => {
    const items = normalizeCompletionItems([
      {
        label: "width",
        detail: "width(value: Length): T",
        kind: "method",
        insertText: "width(${1:value})",
        filterText: "width",
        sortText: "0100-width",
        source: "arkui",
        documentation: "Sets the width of the component.",
        replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
        definitionTarget: { path: "/sdk/ets/component/common.d.ts", line: 20927, column: 5 },
      },
    ], {
      prefix: "wi",
      lineTextBeforeCursor: "    .wi",
      trigger: "typing",
      acceptedLabels: [],
    });

    expect(items[0]).toMatchObject({
      label: "width",
      insertText: "width(${1:value})",
      filterText: "width",
      sortText: "0100-width",
      source: "arkui",
      documentation: "Sets the width of the component.",
      replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
      definitionTarget: { path: "/sdk/ets/component/common.d.ts", line: 20927, column: 5 },
    });
  });
});
