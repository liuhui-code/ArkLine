import type {
  SemanticCompletionItem,
  SemanticDefinitionCandidate,
  SemanticDocumentPosition,
} from "../protocol.js"
import type { SemanticWorkspaceView } from "../workspace/document-store.js"
import { TypeScriptLanguageServiceEngine } from "./typescript-language-service.js"

const MAX_WORKSPACE_ENGINES = 4

export type SemanticTypeStatus = "ready" | "partial" | "unsupported"

export interface SemanticTypeEngineState {
  status: SemanticTypeStatus
  engine: string
  version: string
  generation: number
}

export interface SemanticTypeQueryContext {
  state: SemanticTypeEngineState
  complete(position: SemanticDocumentPosition): SemanticCompletionItem[]
  define(position: SemanticDocumentPosition): SemanticDefinitionCandidate[]
}

interface WorkspaceEngineEntry {
  engine: TypeScriptLanguageServiceEngine
  lastAccess: number
}

export class SemanticTypeEngineRegistry {
  private readonly workspaces = new Map<string, WorkspaceEngineEntry>()
  private accessClock = 0

  prepare(workspace: SemanticWorkspaceView): SemanticTypeQueryContext {
    let entry = this.workspaces.get(workspace.rootPath)
    if (!entry) {
      entry = {
        engine: new TypeScriptLanguageServiceEngine(workspace.rootPath),
        lastAccess: 0,
      }
      this.workspaces.set(workspace.rootPath, entry)
    }
    entry.lastAccess = ++this.accessClock
    const state = entry.engine.prepare(workspace)
    this.evict(workspace.rootPath)
    return {
      state,
      complete: (position) => entry.engine.complete(position),
      define: (position) => entry.engine.define(position),
    }
  }

  workspaceCount(): number {
    return this.workspaces.size
  }

  dispose(): void {
    for (const entry of this.workspaces.values()) entry.engine.dispose()
    this.workspaces.clear()
  }

  private evict(activeRoot: string): void {
    while (this.workspaces.size > MAX_WORKSPACE_ENGINES) {
      const candidate = [...this.workspaces.entries()]
        .filter(([root]) => root !== activeRoot)
        .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0]
      if (!candidate) return
      candidate[1].engine.dispose()
      this.workspaces.delete(candidate[0])
    }
  }
}
