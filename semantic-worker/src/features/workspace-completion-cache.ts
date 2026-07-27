import { collectDocumentSymbolsForPath } from "./document-analysis.js"

import type { SemanticCompletionItem } from "../protocol.js"
import type { SemanticWorkspaceView } from "../workspace/document-store.js"

const MAX_CACHED_DOCUMENTS = 512

type CachedDocumentCompletions = {
  content: string
  items: SemanticCompletionItem[]
  lastAccess: number
}

export class WorkspaceCompletionCache {
  private readonly documents = new Map<string, CachedDocumentCompletions>()
  private accessClock = 0
  private hits = 0
  private misses = 0

  collect(workspace: SemanticWorkspaceView): SemanticCompletionItem[] {
    const protectedPaths = new Set(workspace.documents.map((document) => document.path))
    const items = workspace.documents.flatMap((document) => this.forDocument(document.path, document.content))
    this.evict(protectedPaths)
    return items
  }

  snapshot() {
    return { documents: this.documents.size, hits: this.hits, misses: this.misses }
  }

  private forDocument(documentPath: string, content: string) {
    const cached = this.documents.get(documentPath)
    if (cached?.content === content) {
      cached.lastAccess = ++this.accessClock
      this.hits += 1
      return cached.items
    }

    this.misses += 1
    const items = collectDocumentSymbolsForPath(content, documentPath).flatMap((symbol) =>
      symbol.kind === "function"
        ? [{
          label: `${symbol.name}()`,
          detail: "Semantic workspace function",
          kind: "function",
          source: "workspace" as const,
          data: {
            provider: "workspace-symbol-cache",
            symbolId: `${documentPath}:${symbol.kind}:${symbol.name}:${symbol.line}:${symbol.column}`,
          },
        }]
        : [],
    )
    this.documents.set(documentPath, { content, items, lastAccess: ++this.accessClock })
    return items
  }

  private evict(protectedPaths: Set<string>) {
    if (this.documents.size <= MAX_CACHED_DOCUMENTS) return
    const candidates = [...this.documents.entries()]
      .filter(([documentPath]) => !protectedPaths.has(documentPath))
      .sort((left, right) => left[1].lastAccess - right[1].lastAccess)
    for (const [documentPath] of candidates) {
      if (this.documents.size <= MAX_CACHED_DOCUMENTS) break
      this.documents.delete(documentPath)
    }
  }
}
