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
  documentation?: string
  overloads?: Array<{
    signature: string
    line: number
    column: number
    detail: string
  }>
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
  const matchingEntries = entries
    .filter((entry) => !entry.component || entry.component === component)
    .sort((left, right) => {
      if (!component) {
        return 0
      }

      const leftExact = left.component === component ? 0 : 1
      const rightExact = right.component === component ? 0 : 1
      return leftExact - rightExact
    })

  return matchingEntries.filter((entry) => {
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
    const methods = commonMethods.filter((item) => item.name === name)
    const primary = methods[0]
    return primary
      ? [{
        name,
        kind: "universalAttribute" as const,
        path: primary.path ?? commonDeclarationPath,
        line: primary.line,
        column: primary.column,
        signature: normalizeSignature(primary.signature),
        detail: normalizeSignature(primary.signature),
        documentation: primary.detail || "ArkUI universal attribute",
        overloads: methods.map((method) => ({
          signature: normalizeSignature(method.signature),
          line: method.line,
          column: method.column,
          detail: method.detail,
        })),
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
    const componentMethods = collectMethods(declarationPath)
    for (const attr of metadata.attrs) {
      const methods = componentMethods.filter((item) => item.name === attr)
      const primary = methods[0]
      entries.push({
        name: attr,
        kind: "componentAttribute",
        component: metadata.name,
        path: primary?.path ?? declarationPath,
        line: primary?.line ?? 1,
        column: primary?.column ?? 1,
        signature: primary ? normalizeSignature(primary.signature) : `${attr}(...)`,
        detail: primary ? normalizeSignature(primary.signature) : `ArkUI ${metadata.name} attribute`,
        documentation: primary?.detail ?? `ArkUI ${metadata.name} attribute`,
        overloads: methods.map((method) => ({
          signature: normalizeSignature(method.signature),
          line: method.line,
          column: method.column,
          detail: method.detail,
        })),
      })
    }
  }

  return entries
}

function collectMethods(filePath: string) {
  const content = readDocument(filePath)
  if (!content) {
    return []
  }

  const lines = content.split(/\r?\n/)
  return collectDocumentMethodSymbolsForPath(content, filePath).map((method) => ({
    ...method,
    detail: method.detail || docSummaryBefore(lines, method.line) || "",
  }))
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

function normalizeSignature(signature: string): string {
  return signature.replace(/;\s*$/, "")
}

function docSummaryBefore(lines: string[], line: number): string | null {
  const previous = lines[line - 2] ?? ""
  const singleLine = previous.match(/\/\*\*\s*(.*?)\s*\*\//)?.[1]
  if (singleLine) {
    return singleLine
  }

  for (let index = line - 2; index >= 0; index -= 1) {
    const summary = lines[index]?.match(/^\s*\*\s+([^@].*?)\s*$/)?.[1]
    if (summary) {
      return summary
    }
    if (lines[index]?.includes("/**")) {
      return null
    }
  }

  return null
}
