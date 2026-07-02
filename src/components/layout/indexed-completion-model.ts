import type { CurrentClassMethod } from "@/features/workspace/current-class-methods";
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

const arkTsKeywords = [
  "public",
  "private",
  "protected",
  "static",
  "async",
  "readonly",
  "let",
  "const",
  "function",
  "class",
  "struct",
  "interface",
  "enum",
  "extends",
  "implements",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "return",
  "new",
  "this",
  "super",
  "import",
  "export",
  "from",
  "as",
  "try",
  "catch",
  "finally",
  "throw",
  "await",
  "break",
  "continue",
  "true",
  "false",
  "null",
  "undefined",
];

export function candidateToCurrentClassMethod(candidate: SearchCandidate): CurrentClassMethod {
  const kind = candidate.kind === "method" || candidate.kind === "function" ? "method" : "member";
  return {
    kind,
    name: candidate.title,
    signature: candidate.signature ?? (kind === "method" ? `${candidate.title}()` : candidate.title),
    line: candidate.line ?? 1,
    column: candidate.column ?? 1,
  };
}

export function candidateToCompletionItem(
  candidate: SearchCandidate,
  scope: "currentFile" | "workspace" = "workspace",
): LanguageCompletionItem {
  const callable = candidate.kind === "function" || candidate.kind === "method";
  const label = callable && !candidate.title.endsWith(")") ? `${candidate.title}()` : candidate.title;
  const definitionTarget = candidate.path
    ? { path: candidate.path, line: candidate.line ?? 1, column: candidate.column ?? 1 }
    : undefined;
  const source = candidate.source === "api" ? "sdk" : scope === "workspace" ? "workspace" : undefined;
  const detailPrefix = scope === "currentFile" ? "Current file" : candidate.source === "api" ? "Indexed API" : "Indexed";
  const detailParts = [
    detailPrefix,
    candidate.visibility,
    candidate.kind || candidate.source,
    candidate.container ? `in ${candidate.container}` : undefined,
    candidate.signature,
    candidate.path && candidate.line ? `${candidate.path}:${candidate.line}` : undefined,
  ].filter(Boolean);

  return {
    label,
    detail: detailParts.join(" · "),
    kind: candidate.kind || candidate.source,
    insertText: label,
    filterText: candidate.title,
    ...(source ? { source } : {}),
    definitionTarget,
  };
}

export function keywordCompletionItems(query: string): LanguageCompletionItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return [];
  }

  return arkTsKeywords
    .filter((keyword) => keyword.startsWith(normalizedQuery))
    .map((keyword) => ({
      label: keyword,
      detail: "ArkTS keyword",
      kind: "keyword",
      insertText: keyword,
      filterText: keyword,
      source: "arkts",
    }));
}

export function mergeCompletionItems(...groups: LanguageCompletionItem[][]) {
  const seen = new Set<string>();
  const merged: LanguageCompletionItem[] = [];
  for (const item of groups.flat()) {
    const key = `${item.label}\u0000${item.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}
