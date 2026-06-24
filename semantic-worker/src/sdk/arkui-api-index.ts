import fs from "node:fs"
import path from "node:path"

import { collectDocumentMethodSymbolsForPath, readDocument } from "../features/document-analysis.js"

export type ArkuiApiEntry = {
  name: string
  kind: "universalAttribute" | "componentAttribute"
  component?: string
  path: string
  line: number
  column: number
  signature: string
  detail: string
}

type ComponentMetadata = {
  name?: string
  attrs?: string[]
}

const cache = new Map<string, ArkuiApiEntry[]>()

export function clearArkuiApiIndexCache(): void {
  cache.clear()
}

export function loadArkuiApiIndex(sdkRoot: string | undefined): ArkuiApiEntry[] {
  if (!sdkRoot) {
    return []
  }

  if (cache.has(sdkRoot)) {
    return cache.get(sdkRoot) ?? []
  }

  const entries = buildArkuiApiIndex(sdkRoot)
  cache.set(sdkRoot, entries)
  return entries
}

export function findArkuiApiDefinition(
  sdkRoot: string | undefined,
  name: string,
  component?: string | null,
): ArkuiApiEntry | null {
  const entries = loadArkuiApiIndex(sdkRoot)
  const componentMatch = component
    ? entries.find((entry) => entry.name === name && entry.component === component)
    : null

  return componentMatch
    ?? entries.find((entry) => entry.name === name && entry.kind === "universalAttribute")
    ?? entries.find((entry) => entry.name === name)
    ?? null
}

export function completeArkuiApis(
  sdkRoot: string | undefined,
  component?: string | null,
): ArkuiApiEntry[] {
  const entries = loadArkuiApiIndex(sdkRoot)
  const seen = new Set<string>()

  return entries.filter((entry) => {
    if (entry.component && entry.component !== component) {
      return false
    }

    if (seen.has(entry.name)) {
      return false
    }

    seen.add(entry.name)
    return true
  })
}

function buildArkuiApiIndex(sdkRoot: string): ArkuiApiEntry[] {
  const commonDeclarationPath = path.join(sdkRoot, "ets", "component", "common.d.ts")
  const commonMethods = collectMethods(commonDeclarationPath)
  const commonAttrs = readAttrs(
    path.join(sdkRoot, "ets", "build-tools", "ets-loader", "components", "common_attrs.json"),
  )
  const entries: ArkuiApiEntry[] = commonAttrs.flatMap((name) => {
    const method = commonMethods.find((item) => item.name === name)
    return method
      ? [{
        name,
        kind: "universalAttribute" as const,
        path: method.path ?? commonDeclarationPath,
        line: method.line,
        column: method.column,
        signature: method.signature,
        detail: method.detail || "ArkUI universal attribute",
      }]
      : []
  })

  const componentsDir = path.join(sdkRoot, "ets", "build-tools", "ets-loader", "components")
  for (const metadataPath of listJsonFiles(componentsDir)) {
    if (path.basename(metadataPath) === "common_attrs.json") {
      continue
    }

    const metadata = readComponentMetadata(metadataPath)
    if (!metadata.name || !metadata.attrs) {
      continue
    }

    const declarationPath = path.join(sdkRoot, "ets", "component", `${camelToSnake(metadata.name)}.d.ts`)
    const methods = collectMethods(declarationPath)
    for (const attr of metadata.attrs) {
      const method = methods.find((item) => item.name === attr)
      entries.push({
        name: attr,
        kind: "componentAttribute",
        component: metadata.name,
        path: method?.path ?? declarationPath,
        line: method?.line ?? 1,
        column: method?.column ?? 1,
        signature: method?.signature ?? `${attr}(...)`,
        detail: method?.detail ?? `ArkUI ${metadata.name} attribute`,
      })
    }
  }

  return entries
}

function collectMethods(filePath: string) {
  const content = readDocument(filePath)
  return content ? collectDocumentMethodSymbolsForPath(content, filePath) : []
}

function readAttrs(filePath: string): string[] {
  return readComponentMetadata(filePath).attrs ?? []
}

function readComponentMetadata(filePath: string): ComponentMetadata {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ComponentMetadata
  } catch {
    return {}
  }
}

function listJsonFiles(directoryPath: string): string[] {
  try {
    return fs.readdirSync(directoryPath)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(directoryPath, name))
  } catch {
    return []
  }
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (match, index) => `${index === 0 ? "" : "_"}${match.toLowerCase()}`)
}
