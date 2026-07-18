import { collectDocumentSymbolsForPath } from "./document-analysis.js"
import { discoverHarmonySdk } from "../sdk/discovery.js"
import { completeArkuiApis } from "../sdk/arkui-api-index.js"
import { completeArktsKeywords } from "./arkts-keywords.js"
import { findArkuiContext } from "./arkui-context.js"

import type {
  SemanticCompletionItem,
  SemanticDocumentPosition,
  SemanticResponsePayload,
} from "../protocol.js"
import type { ArkuiApiEntry } from "../sdk/arkui-api-index.js"
import type { SemanticWorkspaceView } from "../workspace/document-store.js"
import type { SemanticTypeQueryContext } from "../types/type-engine.js"

export function resolveCompletion(
  position: SemanticDocumentPosition | undefined,
  workspace: SemanticWorkspaceView | undefined,
  typeEngine?: SemanticTypeQueryContext,
): SemanticResponsePayload {
  if (!position || !workspace) {
    return []
  }

  const currentPath = workspace.state.path
  const currentDocument = workspace.documents.find((document) => document.path === currentPath)
  if (!currentDocument) {
    return []
  }

  const content = currentDocument.content

  const labels: SemanticCompletionItem[] = []
  const seen = new Set<string>()
  const push = (item: SemanticCompletionItem) => {
    if (!seen.has(item.label)) {
      seen.add(item.label)
      labels.push(item)
    }
  }

  if (content.includes("@Entry")) {
    push({ label: "@Entry", detail: "ArkTS decorator", kind: "keyword", source: "arkts" })
  }

  if (content.includes("@Component")) {
    push({ label: "@Component", detail: "ArkTS decorator", kind: "keyword", source: "arkts" })
  }

  if (content.includes("struct ") || content.includes("@Component")) {
    push({ label: "build()", detail: "Component lifecycle method", kind: "method", source: "arkts" })
  }

  for (const keyword of completeArktsKeywords(content, position)) {
    push(keyword)
  }

  for (const item of typeEngine?.complete(position) ?? []) {
    push(item)
  }

  for (const symbol of workspace.documents.flatMap((document) =>
    collectDocumentSymbolsForPath(document.content, document.path),
  )) {
    if (symbol.kind === "function") {
      push({
        label: `${symbol.name}()`,
        detail: "Semantic workspace function",
        kind: "function",
        source: "workspace",
      })
    }
  }

  const arkuiContext = findArkuiContext(content, position)
  if (arkuiContext) {
    const sdkPath = discoverHarmonySdk().path ?? undefined
    for (const entry of completeArkuiApis(sdkPath, arkuiContext.component)) {
      if (arkuiContext.symbolPrefix && !entry.name.toLowerCase().startsWith(arkuiContext.symbolPrefix.toLowerCase())) {
        continue
      }
      push({
        label: entry.name,
        detail: entry.signature || entry.detail,
        kind: "method",
        insertText: snippetForArkuiMethod(entry),
        filterText: entry.name,
        sortText: `0100-${entry.name}`,
        source: "arkui",
        documentation: entry.documentation ?? entry.detail,
        replacementRange: arkuiContext.replacementRange,
        commitCharacters: ["("],
        definitionTarget: { path: entry.path, line: entry.line, column: entry.column },
        data: { provider: "arkui-sdk", component: entry.component ?? null },
      })
    }
  }

  return labels
}

function snippetForArkuiMethod(entry: Pick<ArkuiApiEntry, "name" | "signature">): string {
  const firstParam = entry.signature.match(/\(([^):,\s]+)/)?.[1] ?? "value"
  return `${entry.name}(\${1:${firstParam}})`
}
