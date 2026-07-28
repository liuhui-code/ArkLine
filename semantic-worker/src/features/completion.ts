import { discoverHarmonySdk } from "../sdk/discovery.js"
import { completeArkuiApis } from "../sdk/arkui-api-index.js"
import { completeArktsKeywords } from "./arkts-keywords.js"
import { findArkuiContext } from "./arkui-context.js"
import { isMemberAccessCompletion } from "./completion-context.js"
import { WorkspaceCompletionCache } from "./workspace-completion-cache.js"

import type {
  SemanticCompletionItem,
  SemanticDocumentPosition,
  SemanticResponsePayload,
} from "../protocol.js"
import type { ArkuiApiEntry } from "../sdk/arkui-api-index.js"
import type { SemanticWorkspaceView } from "../workspace/document-store.js"
import type { SemanticTypeQueryContext } from "../types/type-engine.js"

const workspaceCompletionCache = new WorkspaceCompletionCache()

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
  const memberAccess = isMemberAccessCompletion(content, position)

  const labels: SemanticCompletionItem[] = []
  const seen = new Set<string>()
  const push = (item: SemanticCompletionItem) => {
    const identity = completionIdentity(item)
    if (!seen.has(identity)) {
      seen.add(identity)
      labels.push(item)
    }
  }

  if (!memberAccess) {
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
  }

  for (const item of typeEngine?.complete(position) ?? []) {
    if (!memberAccess || item.kind !== "keyword") {
      push(item)
    }
  }

  if (!memberAccess) {
    for (const item of workspaceCompletionCache.collect(workspace)) {
      push(item)
    }
  }

  const arkuiContext = findArkuiContext(content, position)
  if (arkuiContext) {
    const sdkPath = discoverHarmonySdk().path ?? undefined
    for (const entry of completeArkuiApis(sdkPath, arkuiContext.component, arkuiContext.symbolPrefix)) {
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
        data: {
          provider: "arkui-sdk",
          component: entry.component ?? null,
          symbolId: `${entry.path}:${entry.line}:${entry.column}:${entry.name}`,
        },
      })
    }
  }

  return labels
}

function completionIdentity(item: SemanticCompletionItem): string {
  const symbolId = typeof item.data?.symbolId === "string" ? item.data.symbolId : ""
  return symbolId
    ? `${item.source ?? "unknown"}:${symbolId}`
    : `${item.source ?? "unknown"}:${item.kind}:${item.label}:${item.insertText ?? ""}:${item.detail}`
}

function snippetForArkuiMethod(entry: Pick<ArkuiApiEntry, "name" | "signature">): string {
  const firstParam = entry.signature.match(/\(([^):,\s]+)/)?.[1] ?? "value"
  return `${entry.name}(\${1:${firstParam}})`
}
