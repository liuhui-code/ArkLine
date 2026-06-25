import {
  listCodeActions,
  prepareRename,
  rename,
  resolveCodeAction,
} from "./features/code-actions.js"
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
}
