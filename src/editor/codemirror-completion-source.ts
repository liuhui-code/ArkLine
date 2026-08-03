import type {
  Completion,
  CompletionContext,
  CompletionInfo,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { snippetCompletion } from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import { collectImmediateCompletionCandidates } from "@/components/layout/completion-candidate-provider";
import { completionItemIdentity } from "@/components/layout/completion-item-identity";
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";
import { normalizePath } from "@/features/workspace/workspace-store";
import { createVersionCheckedCompletionTransaction, type CompletionTextChange } from "@/editor/completion-transaction";

export type CodeMirrorCompletionRequest = {
  path: string;
  document: Text;
  lineText: string;
  line: number;
  column: number;
  explicit: boolean;
  query: string;
  replacePrefix: string;
};

export type CodeMirrorCompletionBroker = (
  request: CodeMirrorCompletionRequest,
) => Promise<LanguageCompletionItem[]>;

export type CodeMirrorCompletionResolver = (
  item: LanguageCompletionItem,
  request: CodeMirrorCompletionRequest,
) => Promise<LanguageCompletionItem | null>;

type CompletionPosition = CodeMirrorCompletionRequest & {
  from: number;
};

const wordPattern = /[A-Za-z0-9_$]*$/;
const validCompletionRange = /^\.?[A-Za-z0-9_$]*$/;

export function createCodeMirrorCompletionSources(
  path: () => string | null,
  broker: CodeMirrorCompletionBroker,
  resolver?: CodeMirrorCompletionResolver,
  isEnabled: () => boolean = () => true,
): CompletionSource[] {
  const completionCache = new Map<string, Completion>();
  return [
    createImmediateCompletionSource(path, completionCache, resolver, isEnabled),
    createBrokerCompletionSource(path, broker, completionCache, resolver, isEnabled),
  ];
}

function createImmediateCompletionSource(
  path: () => string | null,
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
  isEnabled: () => boolean = () => true,
): CompletionSource {
  return (context) => {
    if (!isEnabled()) return null;
    const position = readCompletionPosition(context, path);
    if (!position || (!context.explicit && !hasCompletionTrigger(context, position))) return null;

    const items = collectImmediateCompletionCandidates(position.query, {
      lineText: position.lineText,
      line: position.line,
      column: position.column,
    });
    return buildResult(position, items, completionCache, resolver, true);
  };
}

function createBrokerCompletionSource(
  path: () => string | null,
  broker: CodeMirrorCompletionBroker,
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
  isEnabled: () => boolean = () => true,
): CompletionSource {
  return async (context) => {
    if (!isEnabled()) return null;
    const position = readCompletionPosition(context, path);
    if (!position || (!context.explicit && !hasCompletionTrigger(context, position))) return null;

    const items = await broker(position);
    if (context.aborted) return null;
    return buildResult(position, items, completionCache, resolver, false);
  };
}

function readCompletionPosition(context: CompletionContext, path: () => string | null): CompletionPosition | null {
  const activePath = path();
  if (!activePath) return null;

  const line = context.state.doc.lineAt(context.pos);
  const word = context.matchBefore(wordPattern);
  return {
    path: activePath,
    document: context.state.doc,
    lineText: line.text,
    line: line.number,
    column: context.pos - line.from + 1,
    explicit: context.explicit,
    from: word?.from ?? context.pos,
    query: context.state.doc.sliceString(word?.from ?? context.pos, context.pos),
    replacePrefix: context.state.doc.sliceString(word?.from ?? context.pos, context.pos),
  };
}

function hasCompletionTrigger(context: CompletionContext, position: CompletionPosition) {
  const prefix = context.state.doc.sliceString(position.from, context.pos);
  if (prefix.length > 0) return true;
  const previous = context.pos > 0 ? context.state.doc.sliceString(context.pos - 1, context.pos) : "";
  return /[.([{,:#]/.test(previous);
}

function buildResult(
  position: CompletionPosition,
  items: LanguageCompletionItem[],
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
  reuseWhileTyping = false,
): CompletionResult | null {
  if (items.length === 0) return null;
  return {
    from: resolveReplacementFrom(position, items),
    options: items.map((item) => toCompletion(position, item, completionCache, resolver)),
    filter: reuseWhileTyping ? undefined : false,
    validFor: reuseWhileTyping ? validCompletionRange : undefined,
  };
}

function toCompletion(
  position: CompletionPosition,
  item: LanguageCompletionItem,
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
): Completion {
  const identity = completionItemIdentity(item);
  const cached = completionCache.get(identity);
  const resolvesOnApply = resolver && item.data?.provider === "typescript";
  if (cached && !resolver) return cached;

  const insertText = item.insertText ?? item.label;
  const resolution = resolver ? createLazyResolution(item, position, resolver) : undefined;
  const completion: Completion = {
    label: item.filterText ?? item.label,
    displayLabel: item.filterText ? item.label : undefined,
    detail: item.detail,
    type: completionType(item.kind),
    sortText: item.sortText,
    apply: isSnippetTemplate(insertText)
      ? undefined
      : resolvesOnApply && resolution
        ? createResolvedApply(position, insertText, resolution)
        : insertText,
    commitCharacters: item.commitCharacters,
    info: resolution?.info ?? createCompletionInfo(item),
  };
  const result = isSnippetTemplate(insertText)
    ? snippetCompletion(insertText, completion)
    : completion;
  if (!resolver) completionCache.set(identity, result);
  if (completionCache.size > 512) {
    const oldest = completionCache.keys().next().value;
    if (oldest) completionCache.delete(oldest);
  }
  return result;
}

function createLazyResolution(
  item: LanguageCompletionItem,
  position: CompletionPosition,
  resolver: CodeMirrorCompletionResolver,
): {
  resolve: () => Promise<LanguageCompletionItem | null>;
  info: (completion: Completion) => Promise<CompletionInfo>;
} {
  let resolved: Promise<LanguageCompletionItem | null> | undefined;
  const resolve = () => {
    resolved ??= resolver(item, position).catch(() => item);
    return resolved;
  };
  return { resolve, info: async () => {
    const result = await resolve();
    return result ? renderCompletionInfo(result) : null;
  } };
}

function createCompletionInfo(item: LanguageCompletionItem): Completion["info"] {
  if (!item.documentation && !item.definitionTarget) return undefined;
  return () => renderCompletionInfo(item);
}

function renderCompletionInfo(item: LanguageCompletionItem): CompletionInfo {
  if (typeof document === "undefined") return null;
  const details = document.createElement("div");
  details.className = "arkline-completion-info";
  details.setAttribute("aria-label", "Completion Details");
  details.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
  });

  if (item.detail) {
    const signature = document.createElement("div");
    signature.className = "arkline-completion-info__signature";
    signature.textContent = item.detail;
    details.append(signature);
  }
  if (item.documentation) {
    const documentation = document.createElement("div");
    documentation.className = "arkline-completion-info__documentation";
    documentation.textContent = item.documentation;
    details.append(documentation);
  }
  if (item.definitionTarget) {
    const source = document.createElement("div");
    source.className = "arkline-completion-info__source";
    const path = item.definitionTarget.path.replace(/\\/g, "/");
    source.textContent = `${path.split("/").pop() ?? path}:${item.definitionTarget.line}:${item.definitionTarget.column}`;
    source.title = path;
    details.append(source);
  }
  return details;
}

function createResolvedApply(
  position: CompletionPosition,
  insertText: string,
  resolution: { resolve: () => Promise<LanguageCompletionItem | null> },
): NonNullable<Completion["apply"]> {
  return (view, completion, from, to) => {
    void resolution.resolve().then((resolved) => {
      const additionalChanges = resolved
        ? resolveAdditionalChanges(position, resolved)
        : [];
      if (additionalChanges === null) return;
      const transaction = createVersionCheckedCompletionTransaction({
        state: view.state,
        expectedDocument: position.document,
        from,
        to,
        insertText,
        additionalChanges,
        completion,
      });
      if (transaction) view.dispatch(transaction);
    });
  };
}

function resolveAdditionalChanges(
  position: CompletionPosition,
  item: LanguageCompletionItem,
): CompletionTextChange[] | null {
  const documentVersion = typeof item.data?.documentVersion === "number"
    ? item.data.documentVersion
    : undefined;
  const edits = item.additionalTextEdits ?? [];
  const changes: CompletionTextChange[] = [];
  for (const edit of edits) {
    if (normalizePath(edit.path) !== normalizePath(position.path)) return null;
    if (edit.expectedVersion !== undefined && edit.expectedVersion !== documentVersion) return null;
    const change = textRangeToChange(position.document, edit.range, edit.newText);
    if (!change) return null;
    changes.push(change);
  }
  return changes;
}

function textRangeToChange(
  document: Text,
  range: NonNullable<LanguageCompletionItem["replacementRange"]>,
  insert: string,
): CompletionTextChange | null {
  if (range.startLine < 1 || range.endLine < range.startLine || range.endLine > document.lines) return null;
  const startLine = document.line(range.startLine);
  const endLine = document.line(range.endLine);
  const from = startLine.from + range.startColumn - 1;
  const to = endLine.from + range.endColumn - 1;
  if (range.startColumn < 1 || range.endColumn < 1 || from > startLine.to || to > endLine.to || to < from) return null;
  return { from, to, insert };
}

function isSnippetTemplate(value: string) {
  return /\$(?:\{\d+(?::[^}]*)?\}|\d+)/.test(value);
}

function completionType(kind: string) {
  const normalized = kind.toLowerCase();
  if (normalized === "function") return "function";
  if (normalized === "method") return "method";
  if (normalized === "property") return "property";
  if (normalized === "class") return "class";
  if (normalized === "keyword") return "keyword";
  if (normalized === "variable") return "variable";
  return "text";
}

function resolveReplacementFrom(position: CompletionPosition, items: LanguageCompletionItem[]) {
  const line = position.document.line(position.line);
  const starts = items
    .map((item) => item.replacementRange)
    .filter((range) => range
      && range.startLine === position.line
      && range.endLine === position.line
      && range.startColumn >= 1
      && range.endColumn === position.column)
    .map((range) => line.from + range!.startColumn - 1);
  return starts.length > 0 ? Math.min(...starts) : position.from;
}
