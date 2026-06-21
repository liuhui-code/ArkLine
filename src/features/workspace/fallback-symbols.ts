import type { DocumentSymbol, LanguageCompletionItem } from "@/features/workspace/workspace-api";

const declarationPattern = /\b(struct|class|interface|enum|type|function)\s+([A-Za-z0-9_$]+)/;

export function collectFallbackDocumentSymbols(content: string): DocumentSymbol[] {
  return content
    .split(/\r?\n/)
    .flatMap((lineText, index) => {
      const match = lineText.match(declarationPattern);
      if (!match) {
        return [];
      }

      return [{
        name: match[2]!,
        kind: match[1]!,
        line: index + 1,
        column: lineText.indexOf(match[2]!) + 1,
      }];
    });
}

export function collectFallbackCompletions(content: string): LanguageCompletionItem[] {
  const items: LanguageCompletionItem[] = [];
  const seen = new Set<string>();

  const push = (label: string, detail: string, kind: string) => {
    if (!label || seen.has(label)) {
      return;
    }

    seen.add(label);
    items.push({ label, detail, kind });
  };

  if (content.includes("@Entry")) {
    push("@Entry", "ArkTS decorator", "keyword");
  }

  if (content.includes("@Component")) {
    push("@Component", "ArkTS decorator", "keyword");
  }

  if (/\bstruct\b/.test(content) || /\b@Component\b/.test(content)) {
    push("build()", "Component lifecycle method", "method");
  }

  for (const symbol of collectFallbackDocumentSymbols(content)) {
    if (symbol.kind === "function") {
      push(`${symbol.name}()`, "Fallback function", "function");
    }
  }

  return items.slice(0, 50);
}
