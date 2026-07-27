import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";

export function completionItemIdentity(item: LanguageCompletionItem): string {
  const provider = item.source ?? "unknown";
  const symbolId = stringData(item, "symbolId");
  const overloadId = stringData(item, "overloadId");
  const completionId = stringData(item, "completionId");
  const location = item.definitionTarget
    ? `${item.definitionTarget.path}:${item.definitionTarget.line}:${item.definitionTarget.column}`
    : "";

  if (completionId) return `${provider}:completion:${completionId}`;
  if (symbolId) return `${provider}:symbol:${symbolId}:${overloadId ?? item.insertText ?? item.label}`;

  return [
    provider,
    item.kind,
    item.label,
    item.insertText ?? "",
    item.detail,
    location,
  ].join("\u0000");
}

export function completionMergeIdentity(item: LanguageCompletionItem): string {
  const overloadId = stringData(item, "overloadId");
  const completionId = stringData(item, "completionId");
  if (overloadId || completionId) return completionItemIdentity(item);
  return `${item.label}\u0000${item.kind}`;
}

function stringData(item: LanguageCompletionItem, key: string) {
  const value = item.data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
