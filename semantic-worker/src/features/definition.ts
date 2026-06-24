import path from "node:path"

import {
  collectDocumentSymbolsForPath,
  readDocument,
  symbolAtPosition,
} from "./document-analysis.js"
import { loadWorkspace } from "../sdk/workspace-loader.js"
import { discoverHarmonySdk } from "../sdk/discovery.js"

import type {
  SemanticDefinitionCandidate,
  SemanticDocumentPosition,
  SemanticResponsePayload,
} from "../protocol.js"

function toDefinitionCandidate(
  position: SemanticDocumentPosition,
  definition: { path?: string; line: number; column: number },
): SemanticDefinitionCandidate {
  return {
    path: definition.path ?? position.path,
    line: definition.line,
    column: definition.column,
  }
}

function resolveImportedModuleCandidates(
  documentPath: string,
  content: string,
  symbol: string,
  candidates: SemanticDefinitionCandidate[],
): SemanticDefinitionCandidate[] {
  const importedModulePaths = content
    .split(/\r?\n/)
    .flatMap((lineText) => {
      const match = lineText.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/)
      if (!match) {
        return []
      }

      const importedNames = match[1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
      if (!importedNames.includes(symbol)) {
        return []
      }

      const modulePath = match[2]
      const basePath = path.resolve(path.dirname(documentPath), modulePath)
      return [`${basePath}.ets`, path.join(basePath, "index.ets")]
    })

  if (importedModulePaths.length === 0) {
    return candidates
  }

  const imported = candidates.filter((candidate) => importedModulePaths.includes(candidate.path))
  if (imported.length === 0) {
    return candidates
  }

  const importedPaths = new Set(imported.map((candidate) => candidate.path))
  const remaining = candidates.filter((candidate) => !importedPaths.has(candidate.path))
  return [...imported, ...remaining]
}

export function resolveDefinitionCandidates(
  position: SemanticDocumentPosition | undefined,
): SemanticDefinitionCandidate[] {
  if (!position) {
    return []
  }

  const workspace = loadWorkspace(position.path)
  const currentDocument = workspace.documents.find((document) => document.path === position.path)
  if (!currentDocument) {
    return []
  }

  const symbol = symbolAtPosition(currentDocument.content, position)
  if (!symbol) {
    return []
  }

  const currentDocumentDefinitions = collectDocumentSymbolsForPath(
    currentDocument.content,
    currentDocument.path,
  )
    .filter((candidate) => candidate.name === symbol)
    .map((candidate) => toDefinitionCandidate(position, candidate))

  if (currentDocumentDefinitions.length > 0) {
    return currentDocumentDefinitions
  }

  const importedSdkDefinitions = resolveImportedSdkCandidates(
    currentDocument.path,
    currentDocument.content,
    symbol,
  )
  if (importedSdkDefinitions.length > 0) {
    return importedSdkDefinitions
  }

  const workspaceDefinitions = workspace.documents
    .filter((document) => document.path !== currentDocument.path)
    .flatMap((document) => collectDocumentSymbolsForPath(document.content, document.path))
    .filter((candidate) => candidate.name === symbol)
    .map((candidate) => toDefinitionCandidate(position, candidate))

  return resolveImportedModuleCandidates(
    currentDocument.path,
    currentDocument.content,
    symbol,
    workspaceDefinitions,
  )
}

function resolveImportedSdkCandidates(
  documentPath: string,
  content: string,
  symbol: string,
): SemanticDefinitionCandidate[] {
  const sdkPath = discoverHarmonySdk().path
  if (!sdkPath) {
    return []
  }

  const importedModules = extractImportedModuleSpecifiers(content)
  if (importedModules.length === 0) {
    return []
  }

  const documents = importedModules.flatMap((moduleSpecifier) =>
    resolveSdkModulePaths(sdkPath, moduleSpecifier).flatMap((modulePath) => {
      const moduleContent = readDocument(modulePath)
      return moduleContent ? [{ path: modulePath, content: moduleContent }] : []
    }),
  )

  return documents.flatMap((document) =>
    collectDocumentSymbolsForPath(document.content, document.path)
      .filter((candidate) => candidate.name === symbol)
      .map((candidate) => toDefinitionCandidate({ path: documentPath, line: 1, column: 1 }, candidate)),
  )
}

function extractImportedModuleSpecifiers(content: string): string[] {
  return content
    .split(/\r?\n/)
    .flatMap((lineText) => {
      const match = lineText.match(/import\s+(?:type\s+)?(?:[^'"]+)\s+from\s+['"]([^'"]+)['"]/)
      return match?.[1] ? [match[1]] : []
    })
}

function resolveSdkModulePaths(sdkRoot: string, moduleSpecifier: string): string[] {
  if (!moduleSpecifier.startsWith("@ohos.")) {
    return []
  }

  return [
    path.join(sdkRoot, "js", "api", `${moduleSpecifier}.d.ts`),
    path.join(sdkRoot, "js", "api", `${moduleSpecifier}.d.ets`),
    path.join(sdkRoot, "ets", "api", `${moduleSpecifier}.d.ts`),
    path.join(sdkRoot, "ets", "api", `${moduleSpecifier}.d.ets`),
  ]
}

export function resolveDefinition(
  position: SemanticDocumentPosition | undefined,
): SemanticResponsePayload {
  const candidates = resolveDefinitionCandidates(position)
  if (candidates.length === 0) {
    return null
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  return {
    definition: candidates[0],
    definitionCandidates: candidates,
  }
}
