import {
  listCodeActions,
  prepareRename,
  rename,
  resolveCodeAction,
} from "./features/code-actions.js"
import { resolveCompletion } from "./features/completion.js"
import { resolveDefinition } from "./features/definition.js"
import { SEMANTIC_PROTOCOL_VERSION, type SemanticRequest, type SemanticResponse } from "./protocol.js"
import { discoverHarmonySdk } from "./sdk/discovery.js"
import { SemanticDocumentStore, type SemanticWorkspaceView } from "./workspace/document-store.js"
import { SemanticQueryCache, semanticQueryCacheKey } from "./workspace/query-cache.js"
import { SemanticTypeEngineRegistry, type SemanticTypeQueryContext } from "./types/type-engine.js"

export class SemanticWorkerSession {
  private readonly documents = new SemanticDocumentStore()
  private readonly queryCache = new SemanticQueryCache()
  private readonly typeEngines = new SemanticTypeEngineRegistry()

  handle(request: SemanticRequest): SemanticResponse {
    let response: SemanticResponse
    try {
      response = this.handleRequest(request)
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        payload: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return { ...response, runtime: semanticRuntimeState() }
  }

  private handleRequest(request: SemanticRequest): SemanticResponse {
    switch (request.method) {
      case "health":
        return {
          id: request.id,
          ok: true,
          payload: {
            status: discoverHarmonySdk().ready ? "ready" : "ready",
            protocolVersion: SEMANTIC_PROTOCOL_VERSION,
            capabilities: ["completion", "definition", "typeReadiness", "generations", "documentReplay"],
          },
        }
      case "restoreDocuments":
        return {
          id: request.id,
          ok: true,
          payload: {
            restoredDocumentCount: this.documents.restore(request.documents ?? []),
          },
        }
      case "gotoDefinition":
        return this.handleSemanticQuery(request, "gotoDefinition")
      case "completion":
        return this.handleSemanticQuery(request, "completion")
      case "listCodeActions":
        return {
          id: request.id,
          ok: true,
          payload: listCodeActions(request.position),
        }
      case "resolveCodeAction":
        return {
          id: request.id,
          ok: true,
          payload: resolveCodeAction(request.action),
        }
      case "prepareRename":
        return {
          id: request.id,
          ok: true,
          payload: prepareRename(),
        }
      case "rename":
        return {
          id: request.id,
          ok: true,
          payload: rename(),
        }
      default:
        return {
          id: request.id,
          ok: false,
          payload: null,
          error: `Unsupported method: ${String(request.method)}`,
        }
    }
  }

  private handleSemanticQuery(
    request: SemanticRequest,
    method: "gotoDefinition" | "completion",
  ): SemanticResponse {
    if (!request.position) {
      return { id: request.id, ok: true, payload: method === "completion" ? [] : null }
    }
    const baseWorkspace = this.documents.prepare(request.position)
    const typeEngine = this.typeEngines.prepare(baseWorkspace)
    const workspace: SemanticWorkspaceView = {
      ...baseWorkspace,
      state: {
        ...baseWorkspace.state,
        typeStatus: typeEngine.state.status,
        typeEngine: typeEngine.state.engine,
        typeEngineVersion: typeEngine.state.version,
        typeGeneration: typeEngine.state.generation,
      },
    }
    const key = semanticQueryCacheKey(
      method,
      workspace.state,
      request.position.line,
      request.position.column,
    )
    const cached = this.queryCache.get(key)
    if (cached) {
      return {
        id: request.id,
        ok: true,
        payload: cached.payload,
        state: { ...workspace.state, queryCacheHit: true },
      }
    }

    const payload = this.resolveSemanticPayload(method, request, workspace, typeEngine)
    this.queryCache.set(key, { payload, state: workspace.state })
    return { id: request.id, ok: true, payload, state: workspace.state }
  }

  private resolveSemanticPayload(
    method: "gotoDefinition" | "completion",
    request: SemanticRequest,
    workspace: SemanticWorkspaceView,
    typeEngine: SemanticTypeQueryContext,
  ) {
    return method === "completion"
      ? resolveCompletion(request.position, workspace, typeEngine)
      : resolveDefinition(request.position, workspace, typeEngine)
  }
}

function semanticRuntimeState() {
  const memory = process.memoryUsage()
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    uptimeMs: Math.round(process.uptime() * 1000),
  }
}
