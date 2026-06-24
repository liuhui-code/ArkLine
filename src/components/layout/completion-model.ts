import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";

export type CompletionSurface = "suggestionList" | "inlineGhostText";
export type CompletionTrigger = "manual" | "typing";
export type CompletionSource =
  | "arkuiSdk"
  | "workspace"
  | "currentFile"
  | "snippet"
  | "arkts"
  | "arkui"
  | "sdk"
  | "fallback"
  | "unknown";
export type CompletionItemKind =
  | "method"
  | "property"
  | "class"
  | "struct"
  | "component"
  | "snippet"
  | "keyword"
  | "text"
  | "unknown";

export type CompletionContext = {
  prefix: string;
  lineTextBeforeCursor: string;
  trigger: CompletionTrigger;
  acceptedLabels?: string[];
};

export type CompletionPresentation = {
  id: string;
  label: string;
  insertText: string;
  filterText: string;
  sortText?: string;
  detail: string;
  documentation?: string;
  kind: CompletionItemKind;
  kindLabel: string;
  source: CompletionSource;
  sourceLabel: string;
  replacementRange?: LanguageCompletionItem["replacementRange"];
  definitionTarget?: LanguageCompletionItem["definitionTarget"];
  commitCharacters: string[];
  replacementPrefix: string;
  original: LanguageCompletionItem;
};

const kindLabels: Record<CompletionItemKind, string> = {
  method: "Method",
  property: "Property",
  class: "Class",
  struct: "Struct",
  component: "Component",
  snippet: "Snippet",
  keyword: "Keyword",
  text: "Text",
  unknown: "Unknown",
};

const sourceLabels: Record<CompletionSource, string> = {
  arkuiSdk: "ArkUI SDK",
  workspace: "Workspace",
  currentFile: "Current File",
  snippet: "Snippet",
  arkts: "ArkTS",
  arkui: "ArkUI",
  sdk: "SDK",
  fallback: "Fallback",
  unknown: "Unknown",
};

export function normalizeCompletionItems(
  items: LanguageCompletionItem[],
  context: CompletionContext,
): CompletionPresentation[] {
  return items.map((item, index) => {
    const source = inferCompletionSource(item, context);
    const kind = normalizeCompletionKind(item, source);
    const filterText = item.filterText ?? item.label;
    const insertText = item.insertText ?? item.label;

    return {
      id: `${index}:${source}:${kind}:${item.label}`,
      label: item.label,
      insertText,
      filterText,
      detail: item.detail,
      kind,
      kindLabel: kindLabels[kind],
      source,
      sourceLabel: sourceLabels[source],
      commitCharacters: item.commitCharacters ?? [],
      replacementPrefix: context.prefix,
      original: item,
      ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
      ...(item.documentation !== undefined ? { documentation: item.documentation } : {}),
      ...(item.replacementRange !== undefined ? { replacementRange: item.replacementRange } : {}),
      ...(item.definitionTarget !== undefined ? { definitionTarget: item.definitionTarget } : {}),
    };
  });
}

export function rankCompletionItems(
  items: CompletionPresentation[],
  context: CompletionContext,
): CompletionPresentation[] {
  return [...items].sort((left, right) => compareRank(rankItem(left, context), rankItem(right, context)));
}

function normalizeCompletionKind(item: LanguageCompletionItem, source: CompletionSource): CompletionItemKind {
  const kind = item.kind.trim().toLowerCase();

  if (source === "arkuiSdk" && kind === "class" && /\bcomponent\b/i.test(item.detail)) {
    return "component";
  }

  if (kind === "function") {
    return "method";
  }

  if (isCompletionItemKind(kind)) {
    return kind;
  }

  return "unknown";
}

function isCompletionItemKind(kind: string): kind is CompletionItemKind {
  return Object.prototype.hasOwnProperty.call(kindLabels, kind);
}

function inferCompletionSource(item: LanguageCompletionItem, context: CompletionContext): CompletionSource {
  if (item.source) {
    return item.source;
  }

  const detail = item.detail.toLowerCase();
  const kind = item.kind.trim().toLowerCase();

  if (detail.includes("arkui") || (kind === "property" && isArkUiChainContext(context.lineTextBeforeCursor))) {
    return "arkuiSdk";
  }

  if (detail.includes("snippet")) {
    return "snippet";
  }

  if (detail.includes("fallback")) {
    return "fallback";
  }

  if (detail.includes("current file")) {
    return "currentFile";
  }

  if (detail.includes("workspace") || detail.includes("semantic")) {
    return "workspace";
  }

  return "unknown";
}

function isArkUiChainContext(lineTextBeforeCursor: string) {
  return /\b[A-Z][A-Za-z0-9_]*\([^)]*\)(?:\.[A-Za-z_$][\w$]*\([^)]*\))*\.[A-Za-z_$\w]*$/.test(lineTextBeforeCursor);
}

type RankTuple = [
  matchPriority: number,
  chainSourcePriority: number,
  containsSourcePriority: number,
  containsPositionPriority: number,
  prefixDistancePriority: number,
  recentPriority: number,
  sourcePriority: number,
  kindPriority: number,
  labelPriority: string,
];

function rankItem(item: CompletionPresentation, context: CompletionContext): RankTuple {
  const query = context.prefix.trim().toLowerCase();
  const normalizedLabel = item.label.toLowerCase();
  const normalizedFilterText = item.filterText.toLowerCase();
  const normalizedDetail = item.detail.toLowerCase();
  const hasPrefixMatch = query.length > 0 && (
    normalizedLabel.startsWith(query) || normalizedFilterText.startsWith(query)
  );
  const labelContainsIndex = query.length > 0 ? normalizedLabel.indexOf(query) : -1;
  const filterTextContainsIndex = query.length > 0 ? normalizedFilterText.indexOf(query) : -1;
  const detailContainsIndex = query.length > 0 ? normalizedDetail.indexOf(query) : -1;
  const completionContainsIndex = firstMatchIndex(labelContainsIndex, filterTextContainsIndex);

  return [
    hasPrefixMatch ? 0 : 1,
    chainSourcePriority(item, context),
    containsSourcePriority(hasPrefixMatch, query, completionContainsIndex, detailContainsIndex),
    containsPositionPriority(hasPrefixMatch, query, completionContainsIndex, detailContainsIndex),
    hasPrefixMatch ? prefixDistancePriority(query, normalizedLabel, normalizedFilterText) : Number.MAX_SAFE_INTEGER,
    recentPriority(item, context),
    sourcePriority(item),
    kindPriority(item),
    normalizedLabel,
  ];
}

function chainSourcePriority(item: CompletionPresentation, context: CompletionContext) {
  if (!isArkUiChainContext(context.lineTextBeforeCursor)) {
    return 0;
  }

  return item.source === "arkuiSdk" || item.source === "arkui" ? 0 : 1;
}

function firstMatchIndex(...indexes: number[]) {
  const matches = indexes.filter((index) => index >= 0);
  return matches.length > 0 ? Math.min(...matches) : -1;
}

function prefixDistancePriority(query: string, label: string, filterText: string) {
  const distances = [label, filterText]
    .filter((value) => value.startsWith(query))
    .map((value) => value.length - query.length);

  return distances.length > 0 ? Math.min(...distances) : Number.MAX_SAFE_INTEGER;
}

function containsSourcePriority(
  hasPrefixMatch: boolean,
  query: string,
  labelContainsIndex: number,
  detailContainsIndex: number,
) {
  if (hasPrefixMatch || query.length === 0) {
    return 0;
  }

  if (labelContainsIndex >= 0) {
    return 0;
  }

  if (detailContainsIndex >= 0) {
    return 1;
  }

  return 2;
}

function containsPositionPriority(
  hasPrefixMatch: boolean,
  query: string,
  labelContainsIndex: number,
  detailContainsIndex: number,
) {
  if (hasPrefixMatch || query.length === 0) {
    return 0;
  }

  if (labelContainsIndex >= 0) {
    return labelContainsIndex;
  }

  if (detailContainsIndex >= 0) {
    return detailContainsIndex;
  }

  return Number.MAX_SAFE_INTEGER;
}

function recentPriority(item: CompletionPresentation, context: CompletionContext) {
  const acceptedIndex = context.acceptedLabels?.lastIndexOf(item.label) ?? -1;
  return acceptedIndex >= 0 ? -acceptedIndex - 1 : 0;
}

function sourcePriority(item: CompletionPresentation) {
  const priorities: Record<CompletionSource, number> = {
    currentFile: 0,
    arkuiSdk: 1,
    arkui: 1,
    arkts: 2,
    sdk: 2,
    workspace: 3,
    snippet: 4,
    fallback: 5,
    unknown: 6,
  };

  return priorities[item.source];
}

function kindPriority(item: CompletionPresentation) {
  const priorities: Record<CompletionItemKind, number> = {
    keyword: 0,
    component: 1,
    method: 2,
    property: 3,
    class: 4,
    struct: 5,
    snippet: 6,
    text: 7,
    unknown: 8,
  };

  return priorities[item.kind];
}

function compareRank(left: RankTuple, right: RankTuple) {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (leftValue < rightValue) {
      return -1;
    }

    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
}
