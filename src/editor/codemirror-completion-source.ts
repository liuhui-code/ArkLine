import type {
  Completion,
  CompletionContext,
  CompletionInfo,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { snippetCompletion } from "@codemirror/autocomplete";
import { collectImmediateCompletionCandidates } from "@/components/layout/completion-candidate-provider";
import { completionItemIdentity } from "@/components/layout/completion-item-identity";
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";

export type CodeMirrorCompletionRequest = {
  path: string;
  content: string;
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
) => Promise<LanguageCompletionItem | null>;

type CompletionPosition = CodeMirrorCompletionRequest & {
  from: number;
};

const wordPattern = /[A-Za-z0-9_$]*$/;
const validWord = /^[A-Za-z0-9_$]*$/;

export function createCodeMirrorCompletionSources(
  path: () => string | null,
  broker: CodeMirrorCompletionBroker,
  resolver?: CodeMirrorCompletionResolver,
): CompletionSource[] {
  const completionCache = new Map<string, Completion>();
  return [
    createImmediateCompletionSource(path, completionCache, resolver),
    createBrokerCompletionSource(path, broker, completionCache, resolver),
  ];
}

function createImmediateCompletionSource(
  path: () => string | null,
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
): CompletionSource {
  return (context) => {
    const position = readCompletionPosition(context, path);
    if (!position || (!context.explicit && !hasCompletionTrigger(context, position))) return null;

    const items = collectImmediateCompletionCandidates(position.query, {
      content: position.content,
      line: position.line,
      column: position.column,
    });
    return buildResult(position, items, completionCache, resolver);
  };
}

function createBrokerCompletionSource(
  path: () => string | null,
  broker: CodeMirrorCompletionBroker,
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
): CompletionSource {
  return async (context) => {
    const position = readCompletionPosition(context, path);
    if (!position || (!context.explicit && !hasCompletionTrigger(context, position))) return null;

    const items = await broker(position);
    if (context.aborted) return null;
    return buildResult(position, items, completionCache, resolver);
  };
}

function readCompletionPosition(context: CompletionContext, path: () => string | null): CompletionPosition | null {
  const activePath = path();
  if (!activePath) return null;

  const line = context.state.doc.lineAt(context.pos);
  const word = context.matchBefore(wordPattern);
  return {
    path: activePath,
    content: context.state.doc.toString(),
    line: line.number,
    column: context.pos - line.from + 1,
    explicit: context.explicit,
    from: word?.from ?? context.pos,
    query: context.state.doc.sliceString(word?.from ?? context.pos, context.pos),
    replacePrefix: context.state.doc.sliceString(word?.from ?? context.pos, context.pos),
  };
}

function hasCompletionTrigger(context: CompletionContext, position: CompletionPosition) {
  const prefix = position.content.slice(position.from, context.pos);
  if (prefix.length > 0) return true;
  const previous = context.pos > 0 ? context.state.doc.sliceString(context.pos - 1, context.pos) : "";
  return /[.([{,:#]/.test(previous);
}

function buildResult(
  position: CompletionPosition,
  items: LanguageCompletionItem[],
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
): CompletionResult | null {
  if (items.length === 0) return null;
  return {
    from: resolveReplacementFrom(position, items),
    options: items.map((item) => toCompletion(item, completionCache, resolver)),
    validFor: validWord,
  };
}

function toCompletion(
  item: LanguageCompletionItem,
  completionCache: Map<string, Completion>,
  resolver?: CodeMirrorCompletionResolver,
): Completion {
  const identity = completionItemIdentity(item);
  const cached = completionCache.get(identity);
  if (cached) return cached;

  const insertText = item.insertText ?? item.label;
  const completion: Completion = {
    label: item.label,
    detail: item.detail,
    type: completionType(item.kind),
    sortText: item.sortText,
    apply: isSnippetTemplate(insertText) ? undefined : insertText,
    commitCharacters: item.commitCharacters,
    info: item.documentation ?? (resolver ? createLazyInfo(item, resolver) : undefined),
  };
  const result = isSnippetTemplate(insertText)
    ? snippetCompletion(insertText, completion)
    : completion;
  completionCache.set(identity, result);
  if (completionCache.size > 512) {
    const oldest = completionCache.keys().next().value;
    if (oldest) completionCache.delete(oldest);
  }
  return result;
}

function createLazyInfo(
  item: LanguageCompletionItem,
  resolver: CodeMirrorCompletionResolver,
): (completion: Completion) => Promise<CompletionInfo> {
  let resolved: Promise<LanguageCompletionItem | null> | undefined;
  return async () => {
    resolved ??= resolver(item);
    const result = await resolved;
    if (!result?.documentation || typeof document === "undefined") {
      return null;
    }
    return document.createTextNode(result.documentation);
  };
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
  const starts = items
    .map((item) => item.replacementRange)
    .filter((range) => range
      && range.startLine === position.line
      && range.endLine === position.line
      && range.startColumn >= 1
      && range.endColumn === position.column)
    .map((range) => position.from - (position.column - range!.startColumn));
  return starts.length > 0 ? Math.min(...starts) : position.from;
}
