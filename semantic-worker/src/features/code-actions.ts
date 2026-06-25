import path from "node:path"

import type {
  SemanticCodeActionList,
  SemanticCodeActionRequest,
  SemanticDocumentPosition,
  SemanticResponsePayload,
} from "../protocol.js"

export function listCodeActions(
  position: SemanticDocumentPosition | undefined,
): SemanticCodeActionList {
  if (!position || path.extname(position.path).toLowerCase() !== ".ets") {
    return { actions: [] }
  }

  return {
    actions: [
      {
        id: "arkts.generate.page",
        title: "Generate ArkTS Page",
        kind: "generate",
        provider: "template",
        safety: "needsPreview",
        data: { template: "arkts-page" },
      },
      {
        id: "arkts.generate.component",
        title: "Generate ArkTS Component",
        kind: "generate",
        provider: "template",
        safety: "needsPreview",
        data: { template: "arkts-component" },
      },
      {
        id: "workspace.renameFile",
        title: "Rename File",
        kind: "source",
        provider: "workspace",
        safety: "needsPreview",
        data: { targetPath: position.path },
      },
    ],
  }
}

export function resolveCodeAction(
  action: SemanticCodeActionRequest | undefined,
): SemanticResponsePayload {
  return unsupportedResult(
    action ? `Resolving code action '${action.id}' is not implemented yet.` : "Missing code action.",
  )
}

export function prepareRename(): SemanticResponsePayload {
  return unsupportedResult("Preparing rename edits is not implemented yet.")
}

export function rename(): SemanticResponsePayload {
  return unsupportedResult("Rename edits are not implemented yet.")
}

function unsupportedResult(reason: string): SemanticResponsePayload {
  return {
    status: "unsupported",
    reason,
  }
}
