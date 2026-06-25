import path from "node:path"

import type {
  SemanticCodeActionList,
  SemanticCodeActionRequest,
  SemanticDocumentPosition,
  SemanticResponsePayload,
  SemanticWorkspaceEditPlan,
} from "../protocol.js"
import { renderArkTsComponent, renderArkTsPage } from "./templates.js"

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
        data: { template: "arkts-page", currentPath: position.path, name: "GeneratedPage" },
      },
      {
        id: "arkts.generate.component",
        title: "Generate ArkTS Component",
        kind: "generate",
        provider: "template",
        safety: "needsPreview",
        data: { template: "arkts-component", currentPath: position.path, name: "GeneratedComponent" },
      },
      {
        id: "workspace.renameFile",
        title: "Rename File",
        kind: "source",
        provider: "workspace",
        safety: "needsPreview",
        data: {
          currentPath: position.path,
          targetPath: suggestedRenameTarget(position.path),
        },
      },
    ],
  }
}

export function resolveCodeAction(
  action: SemanticCodeActionRequest | undefined,
): SemanticResponsePayload {
  if (!action) {
    return unsupportedResult("Missing code action.")
  }

  switch (action.id) {
    case "arkts.generate.page":
      return buildGeneratePlan({
        id: "arkts.generate.page",
        title: "Generate ArkTS Page",
        undoLabel: "Remove generated ArkTS page",
        targetPath: templateTargetPath(action.data, "pages", "GeneratedPage"),
        content: renderArkTsPage(templateName(action.data, "GeneratedPage")),
      })
    case "arkts.generate.component":
      return buildGeneratePlan({
        id: "arkts.generate.component",
        title: "Generate ArkTS Component",
        undoLabel: "Remove generated ArkTS component",
        targetPath: templateTargetPath(action.data, "components", "GeneratedComponent"),
        content: renderArkTsComponent(templateName(action.data, "GeneratedComponent")),
      })
    case "workspace.renameFile":
      return buildRenamePlan(action.data)
    default:
      return unsupportedResult(`Resolving code action '${action.id}' is not implemented yet.`)
  }
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

function buildGeneratePlan({
  id,
  title,
  undoLabel,
  targetPath,
  content,
}: {
  id: string
  title: string
  undoLabel: string
  targetPath: string
  content: string
}): SemanticWorkspaceEditPlan {
  return {
    id,
    title,
    operations: [
      {
        kind: "createFile",
        path: targetPath,
        content,
        overwrite: false,
      },
    ],
    conflicts: [],
    affectedFiles: [targetPath],
    undoLabel,
    requiresPreview: true,
  }
}

function buildRenamePlan(data: Record<string, unknown> | undefined): SemanticWorkspaceEditPlan | SemanticResponsePayload {
  const currentPath = stringData(data, "currentPath") ?? stringData(data, "targetPath")
  if (!currentPath) {
    return unsupportedResult("Rename File requires currentPath.")
  }

  const targetPath = stringData(data, "targetPath") ?? suggestedRenameTarget(currentPath)
  return {
    id: `workspace.renameFile.${toPosixPath(currentPath)}`,
    title: `Rename ${toPosixPath(currentPath)} to ${toPosixPath(targetPath)}`,
    operations: [
      {
        kind: "renameFile",
        oldPath: toPosixPath(currentPath),
        newPath: toPosixPath(targetPath),
        overwrite: false,
      },
    ],
    conflicts: [],
    affectedFiles: [toPosixPath(currentPath), toPosixPath(targetPath)],
    undoLabel: `Rename ${toPosixPath(targetPath)} back to ${toPosixPath(currentPath)}`,
    requiresPreview: true,
  }
}

function stringData(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key]
  return typeof value === "string" && value.trim() ? value : undefined
}

function templateName(data: Record<string, unknown> | undefined, fallback: string) {
  return stringData(data, "name") ?? fallback
}

function templateTargetPath(data: Record<string, unknown> | undefined, directoryName: "pages" | "components", fallbackName: string) {
  const explicitTarget = stringData(data, "targetPath")
  if (explicitTarget) {
    return toPosixPath(explicitTarget)
  }

  const name = templateName(data, fallbackName)
  const currentPath = stringData(data, "currentPath")
  const baseDirectory = currentPath ? inferSourceDirectory(currentPath, directoryName) : `src/${directoryName}`
  return toPosixPath(path.join(baseDirectory, `${name}.ets`))
}

function inferSourceDirectory(currentPath: string, directoryName: "pages" | "components") {
  const normalized = toPosixPath(currentPath)
  const parts = normalized.split("/")
  const pagesIndex = parts.lastIndexOf("pages")
  if (pagesIndex >= 0) {
    return [...parts.slice(0, pagesIndex), directoryName].join("/")
  }

  const componentsIndex = parts.lastIndexOf("components")
  if (componentsIndex >= 0) {
    return [...parts.slice(0, componentsIndex), directoryName].join("/")
  }

  const srcIndex = parts.lastIndexOf("src")
  if (srcIndex >= 0) {
    return [...parts.slice(0, -1), directoryName].join("/")
  }

  return `src/${directoryName}`
}

function suggestedRenameTarget(currentPath: string) {
  const normalized = toPosixPath(currentPath)
  const extension = path.extname(normalized) || ".ets"
  const directory = path.posix.dirname(normalized)
  const basename = path.posix.basename(normalized, extension)
  return path.posix.join(directory, `${basename}Renamed${extension}`)
}

function toPosixPath(value: string) {
  return value.replace(/\\/g, "/")
}
