import { resolveCompletion } from "./features/completion.js"
import { resolveDefinition } from "./features/definition.js"
import type { SemanticRequest, SemanticResponse } from "./protocol.js"
import { discoverHarmonySdk } from "./sdk/discovery.js"

export class SemanticWorkerSession {
  handle(request: SemanticRequest): SemanticResponse {
    switch (request.method) {
      case "health":
        return {
          id: request.id,
          ok: true,
          payload: {
            status: discoverHarmonySdk().ready ? "ready" : "ready",
          },
        }
      case "gotoDefinition":
        return {
          id: request.id,
          ok: true,
          payload: resolveDefinition(request.position),
        }
      case "completion":
        return {
          id: request.id,
          ok: true,
          payload: resolveCompletion(request.position),
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
}
