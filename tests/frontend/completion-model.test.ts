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
        id: "arkuiSdk:component:Column()",
        label: "Column()",
        insertText: "Column()",
        detail: "ArkUI component",
        kind: "component",
        kindLabel: "Component",
        source: "arkuiSdk",
        sourceLabel: "ArkUI SDK",
        replacementPrefix: "Co",
        original: backendItems[0],
      },
      {
        id: "workspace:method:submit()",
        label: "submit()",
        insertText: "submit()",
        detail: "Workspace symbol",
        kind: "method",
        kindLabel: "Method",
        source: "workspace",
        sourceLabel: "Workspace",
        replacementPrefix: "Co",
        original: backendItems[1],
      },
    ]);
  });

  it("ranks prefix matches before contains matches with recency only breaking close ties", () => {
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

    expect(rankedLabels).toEqual(["button()", "build()", "rebuild()"]);
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
      "workspace:width()",
      "workspace:wrap()",
    ]);
  });
});
