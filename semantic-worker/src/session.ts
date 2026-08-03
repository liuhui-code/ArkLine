import {
  listCodeActions,
  prepareRename,
  rename,
  resolveCodeAction,
} from "./features/code-actions.js"
import { resolveCompletion } from "./features/completion.js"
import { resolveDefinition } from "./features/definition.js"
import { resolveSignatureHelp } from "./features/signature-help.js"
import { SemanticLatencyRegistry } from "./performance/latency-registry.js"
import { SEMANTIC_PROTOCOL_VERSION, type SemanticRequest, type SemanticResponse } from "./protocol.js"
import { discoverHarmonySdk } from "./sdk/discovery.js"
import { SemanticDocumentStore, type SemanticWorkspaceView } from "./workspace/document-store.js"
import { SemanticQueryCache, semanticQueryCacheKey } from "./workspace/query-cache.js"
import { SemanticTypeEngineRegistry, type SemanticTypeQueryContext } from "./types/type-engine.js"

export class SemanticWorkerSession {
  private readonly documents = new SemanticDocumentStore()
  private readonly queryCache = new SemanticQueryCache()
  private readonly typeEngines = new SemanticTypeEngineRegistry()
  private readonly latencies = new SemanticLatencyRegistry()

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
    return { ...response, runtime: semanticRuntimeState(this.latencies) }
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
            capabilities: ["completion", "completionResolve", "definition", "signatureHelp", "typeReadiness", "generations", "documentReplay", "documentSync", "prepareDocument", "virtualDocuments"],
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
      case "didOpen":
      case "didChange": {
        if (!request.document) {
          return { id: request.id, ok: false, payload: null, error: `${request.method} requires a document` }
        }
        const document = this.documents.sync(request.document)
        this.queryCache.clear()
        return {
          id: request.id,
          ok: true,
          payload: {
            status: "ready",
            path: document.path,
            documentVersion: document.documentVersion ?? request.document.documentVersion,
            contentGeneration: document.contentGeneration,
          },
        }
      }
      case "didClose": {
        if (!request.documentPath) {
          return { id: request.id, ok: false, payload: null, error: "didClose requires documentPath" }
        }
        this.documents.close(request.documentPath)
        this.queryCache.clear()
        return { id: request.id, ok: true, payload: { status: "closed", path: request.documentPath } }
      }
      case "prepareDocument":
        return this.prepareDocument(request)
      case "gotoDefinition":
        return this.handleSemanticQuery(request, "gotoDefinition")
      case "completion":
        return this.handleSemanticQuery(request, "completion")
      case "resolveCompletion":
        return this.resolveCompletion(request)
      case "signatureHelp":
        return this.handleSemanticQuery(request, "signatureHelp")
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
    method: "gotoDefinition" | "completion" | "signatureHelp",
  ): SemanticResponse {
    if (!request.position) {
      return { id: request.id, ok: true, payload: method === "completion" ? [] : null }
    }
    const { workspace, typeEngine } = this.prepareWorkspace(request.position)
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

    const queryStarted = performance.now()
    const payload = this.resolveSemanticPayload(method, request, workspace, typeEngine)
    this.latencies.record(method, performance.now() - queryStarted)
    this.queryCache.set(key, { payload, state: workspace.state })
    return { id: request.id, ok: true, payload, state: workspace.state }
  }

  private prepareDocument(request: SemanticRequest): SemanticResponse {
    if (!request.position) {
      return { id: request.id, ok: false, payload: null, error: "prepareDocument requires a position" }
    }
    const { workspace, typeEngine } = this.prepareWorkspace(request.position)
    return {
      id: request.id,
      ok: true,
      payload: {
        status: "ready",
        path: workspace.state.path,
        contentGeneration: workspace.state.contentGeneration,
        typeStatus: typeEngine.state.status,
        typeGeneration: typeEngine.state.generation,
      },
      state: workspace.state,
    }
  }

  private resolveCompletion(request: SemanticRequest): SemanticResponse {
    if (!request.position || !request.completion) {
      return { id: request.id, ok: false, payload: null, error: "resolveCompletion requires position and completion" }
    }
    const { workspace, typeEngine } = this.prepareWorkspace(request.position)
    const started = performance.now()
    const payload = typeEngine.resolveCompletion(request.position, request.completion)
    this.latencies.record("resolveCompletion", performance.now() - started)
    return { id: request.id, ok: true, payload, state: workspace.state }
  }

  private prepareWorkspace(position: NonNullable<SemanticRequest["position"]>) {
    const workspaceStarted = performance.now()
    const baseWorkspace = this.documents.prepare(position)
    this.latencies.record("workspacePrepare", performance.now() - workspaceStarted)
    const typeStarted = performance.now()
    const typeEngine = this.typeEngines.prepare(baseWorkspace)
    this.latencies.record("typePrepare", performance.now() - typeStarted)
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
    return { workspace, typeEngine }
  }

  private resolveSemanticPayload(
    method: "gotoDefinition" | "completion" | "signatureHelp",
    request: SemanticRequest,
    workspace: SemanticWorkspaceView,
    typeEngine: SemanticTypeQueryContext,
  ) {
    const position = request.position
    if (!position) return method === "completion" ? [] : null
    if (method === "completion") return resolveCompletion(position, workspace, typeEngine)
    if (method === "signatureHelp") return resolveSignatureHelp(position, workspace, typeEngine)
    return resolveDefinition(position, workspace, typeEngine)
  }
}

function semanticRuntimeState(latencies: SemanticLatencyRegistry) {
  const memory = process.memoryUsage()
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    uptimeMs: Math.round(process.uptime() * 1000),
    providerLatencies: latencies.snapshot(),
  }
}
