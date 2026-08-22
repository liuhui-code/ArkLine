import fs from "node:fs"
import path from "node:path"

import ts from "typescript"

import { discoverHarmonySdk } from "../sdk/discovery.js"
import type {
  SemanticCompletionItem,
  SemanticCompletionTextEdit,
  SemanticDefinitionCandidate,
  SemanticDocumentPosition,
  SemanticSignatureHelp,
  SemanticUnsupportedResult,
  SemanticUsageResult,
  SemanticWorkspaceEditPlan,
} from "../protocol.js"
import { resolveHarmonySdkModule } from "../sdk/module-resolver.js"
import { createArktsVirtualDocument, type ArktsVirtualDocument } from "../virtual/arkts-virtual-document.js"
import type { SemanticWorkspaceView } from "../workspace/document-store.js"
import type { SemanticTypeEngineState, SemanticTypeStatus } from "./type-engine.js"
import { lineColumnToOffset, offsetToLineColumn } from "./text-position.js"

const MAX_SCRIPTS = 512
const MAX_SCRIPT_BYTES = 16 * 1024 * 1024
const MAX_COMPLETIONS = 128
const ENGINE_VERSION = `typescript-${ts.version}-arkts-v2`

interface ScriptRecord {
  path: string
  content: string
  sourceContent: string
  virtualDocument: ArktsVirtualDocument
  version: number
  bytes: number
  lastAccess: number
}

export class TypeScriptLanguageServiceEngine {
  private readonly scripts = new Map<string, ScriptRecord>()
  private readonly options: ts.CompilerOptions
  private readonly service: ts.LanguageService
  private accessClock = 0
  private generation = 0
  private scriptBytes = 0

  constructor(private readonly rootPath: string) {
    this.options = {
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      experimentalDecorators: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    }
    this.service = ts.createLanguageService(this.createHost(), ts.createDocumentRegistry())
  }

  prepare(workspace: SemanticWorkspaceView): SemanticTypeEngineState {
    const protectedPaths = new Set<string>()
    for (const removedPath of workspace.removedPaths ?? []) this.removeScript(path.resolve(removedPath))
    for (const document of workspace.documents) {
      const filePath = path.resolve(document.path)
      protectedPaths.add(filePath)
      this.updateScript(filePath, document.content)
    }
    this.evict(protectedPaths)
    return {
      status: workspace.state.syntaxReady ? typeStatus(workspace.state.path) : "unsupported",
      engine: "typescript-language-service",
      version: ENGINE_VERSION,
      generation: this.generation,
    }
  }

  complete(position: SemanticDocumentPosition): SemanticCompletionItem[] {
    const filePath = path.resolve(position.path)
    const script = this.scripts.get(filePath)
    if (!script || !hasCompletionPrefix(script.sourceContent, position)) return []
    script.lastAccess = ++this.accessClock
    const sourceOffset = lineColumnToOffset(script.sourceContent, position.line, position.column)
    const offset = script.virtualDocument.toGeneratedOffset(sourceOffset)
    const prefix = completionPrefix(script.sourceContent, sourceOffset)
    const memberAccess = script.sourceContent.slice(0, sourceOffset - prefix.length).endsWith(".")
    const info = this.service.getCompletionsAtPosition(filePath, offset, {
      includeCompletionsForImportStatements: true,
      includeCompletionsForModuleExports: !memberAccess && prefix.length >= 3,
      includeCompletionsWithInsertText: true,
    })
    if (!info) return []
    const normalizedPrefix = prefix.toLowerCase()
    return info.entries
      .filter((entry) => !normalizedPrefix
        || (entry.filterText ?? entry.name).toLowerCase().startsWith(normalizedPrefix))
      .slice(0, MAX_COMPLETIONS)
      .map((entry) => ({
      label: entry.name,
      detail: typeDetail(entry),
      kind: completionKind(entry.kind),
      insertText: entry.insertText,
      filterText: entry.filterText,
      sortText: entry.sortText,
      source: "type",
      replacementRange: entry.replacementSpan
        ? script.virtualDocument.generatedSpanToSourceRange(
            entry.replacementSpan.start,
            entry.replacementSpan.length,
          )
        : undefined,
      data: {
        provider: "typescript",
        engineVersion: ENGINE_VERSION,
        documentVersion: position.documentVersion,
        entryName: entry.name,
        entrySource: entry.source,
        entryData: entry.data,
      },
      }))
  }

  resolveCompletion(
    position: SemanticDocumentPosition,
    item: SemanticCompletionItem,
  ): SemanticCompletionItem {
    const filePath = path.resolve(position.path)
    const script = this.scripts.get(filePath)
    const data = item.data
    if (!script || data?.provider !== "typescript" || data.engineVersion !== ENGINE_VERSION) return item
    const entryName = typeof data.entryName === "string" ? data.entryName : item.label
    const entrySource = typeof data.entrySource === "string" ? data.entrySource : undefined
    const sourceOffset = lineColumnToOffset(script.sourceContent, position.line, position.column)
    const offset = script.virtualDocument.toGeneratedOffset(sourceOffset)
    const details = this.service.getCompletionEntryDetails(
      filePath,
      offset,
      entryName,
      {},
      entrySource,
      { includeCompletionsForModuleExports: true },
      data.entryData as ts.CompletionEntryData | undefined,
    )
    if (!details) return item
    const detail = ts.displayPartsToString(details.displayParts) || item.detail
    const documentation = optionalDisplayParts(details.documentation ?? []) ?? item.documentation
    return {
      ...item,
      detail,
      documentation,
      additionalTextEdits: this.mapCompletionEdits(filePath, position.documentVersion, details),
      data: { ...data, resolved: true },
    }
  }

  define(position: SemanticDocumentPosition): SemanticDefinitionCandidate[] {
    const filePath = path.resolve(position.path)
    const script = this.scripts.get(filePath)
    if (!script) return []
    script.lastAccess = ++this.accessClock
    const sourceOffset = lineColumnToOffset(script.sourceContent, position.line, position.column)
    const offset = script.virtualDocument.toGeneratedOffset(sourceOffset)
    const definitions = this.service.getDefinitionAtPosition(filePath, offset) ?? []
    const seen = new Set<string>()
    return definitions.flatMap((definition) => {
      const targetPath = path.resolve(definition.fileName)
      const targetScript = this.scripts.get(targetPath)
      const content = targetScript?.sourceContent ?? safeRead(targetPath)
      if (content === null) return []
      const targetOffset = targetScript
        ? targetScript.virtualDocument.toSourceOffset(definition.textSpan.start)
        : definition.textSpan.start
      const target = offsetToLineColumn(content, targetOffset)
      const key = `${targetPath}:${target.line}:${target.column}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ path: targetPath, line: target.line, column: target.column }]
    })
  }

  usages(position: SemanticDocumentPosition): SemanticUsageResult[] {
    const filePath = path.resolve(position.path)
    const script = this.scripts.get(filePath)
    if (!script) return []
    script.lastAccess = ++this.accessClock
    const sourceOffset = lineColumnToOffset(script.sourceContent, position.line, position.column)
    const offset = script.virtualDocument.toGeneratedOffset(sourceOffset)
    const references = this.service.getReferencesAtPosition(filePath, offset) ?? []
    const definitions = new Set((this.service.getDefinitionAtPosition(filePath, offset) ?? [])
      .map((definition) => `${path.resolve(definition.fileName)}:${definition.textSpan.start}:${definition.textSpan.length}`))
    const seen = new Set<string>()
    return references.flatMap((reference) => {
      const targetPath = path.resolve(reference.fileName)
      const spanKey = `${targetPath}:${reference.textSpan.start}:${reference.textSpan.length}`
      if (definitions.has(spanKey)) return []
      const targetScript = this.scripts.get(targetPath)
      const content = targetScript?.sourceContent ?? safeRead(targetPath)
      if (content === null) return []
      const targetOffset = targetScript
        ? targetScript.virtualDocument.toSourceOffset(reference.textSpan.start)
        : reference.textSpan.start
      const target = offsetToLineColumn(content, targetOffset)
      const key = `${targetPath}:${target.line}:${target.column}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{
        path: targetPath,
        line: target.line,
        column: target.column,
        preview: content.split("\n")[target.line - 1]?.trim() ?? "",
        kind: "semantic" as const,
        confidence: "exact" as const,
      }]
    })
  }

  rename(
    position: SemanticDocumentPosition,
    newName: string,
  ): SemanticWorkspaceEditPlan | SemanticUnsupportedResult {
    const filePath = path.resolve(position.path)
    const script = this.scripts.get(filePath)
    if (!script) return unsupportedRename("Rename target is not loaded.")
    if (!isIdentifierText(newName)) {
      return unsupportedRename(`'${newName}' is not a valid identifier.`)
    }
    const sourceOffset = lineColumnToOffset(script.sourceContent, position.line, position.column)
    const offset = script.virtualDocument.toGeneratedOffset(sourceOffset)
    const info = this.service.getRenameInfo(filePath, offset, { allowRenameOfImportPath: false })
    if (!info.canRename) return unsupportedRename(info.localizedErrorMessage)
    const locations = this.service.findRenameLocations(filePath, offset, false, false, true) ?? []
    const operations = locations.flatMap((location) => {
      const targetPath = path.resolve(location.fileName)
      const targetScript = this.scripts.get(targetPath)
      if (!targetScript || !isWithinRoot(this.rootPath, targetPath)) return []
      return [{
        kind: "text" as const,
        path: targetPath,
        range: targetScript.virtualDocument.generatedSpanToSourceRange(
          location.textSpan.start,
          location.textSpan.length,
        ),
        newText: `${location.prefixText ?? ""}${newName}${location.suffixText ?? ""}`,
        expectedContentVersion: contentVersion(targetScript.sourceContent),
      }]
    }).sort(compareTextEdits)
    if (operations.length === 0) return unsupportedRename("No rename locations were found.")
    const affectedFiles = [...new Set(operations.map((operation) => operation.path))].sort()
    return {
      id: `semantic.rename.${contentVersion(`${filePath}:${offset}:${newName}`)}`,
      title: `Rename ${info.displayName} to ${newName}`,
      operations,
      conflicts: [],
      affectedFiles,
      undoLabel: `Undo rename ${info.displayName} to ${newName}`,
      requiresPreview: true,
    }
  }

  signatureHelp(position: SemanticDocumentPosition): SemanticSignatureHelp | null {
    const filePath = path.resolve(position.path)
    const script = this.scripts.get(filePath)
    if (!script) return null
    script.lastAccess = ++this.accessClock
    const sourceOffset = lineColumnToOffset(script.sourceContent, position.line, position.column)
    const offset = script.virtualDocument.toGeneratedOffset(sourceOffset)
    const info = this.service.getSignatureHelpItems(filePath, offset, {
      triggerReason: { kind: "invoked" },
    })
    if (!info) return null

    return {
      signatures: info.items.map((item) => {
        const separator = ts.displayPartsToString(item.separatorDisplayParts)
        const parameters = item.parameters.map((parameter) => ({
          label: ts.displayPartsToString(parameter.displayParts),
          documentation: optionalDisplayParts(parameter.documentation),
        }))
        return {
          label: `${ts.displayPartsToString(item.prefixDisplayParts)}${parameters.map((parameter) => parameter.label).join(separator)}${ts.displayPartsToString(item.suffixDisplayParts)}`,
          documentation: optionalDisplayParts(item.documentation),
          parameters,
        }
      }),
      activeSignature: info.selectedItemIndex,
      activeParameter: info.argumentIndex,
    }
  }

  dispose(): void {
    this.service.dispose()
    this.scripts.clear()
    this.scriptBytes = 0
  }

  private createHost(): ts.LanguageServiceHost {
    return {
      getCompilationSettings: () => this.options,
      getCurrentDirectory: () => this.rootPath,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getProjectVersion: () => String(this.generation),
      getScriptFileNames: () => [...this.scripts.keys()],
      getScriptKind: () => ts.ScriptKind.TS,
      getScriptSnapshot: (fileName) => {
        const content = this.scripts.get(path.resolve(fileName))?.content ?? safeRead(fileName)
        return content === null ? undefined : ts.ScriptSnapshot.fromString(content)
      },
      getScriptVersion: (fileName) => String(this.scripts.get(path.resolve(fileName))?.version ?? 0),
      directoryExists: ts.sys.directoryExists,
      fileExists: (fileName) => this.scripts.has(path.resolve(fileName)) || ts.sys.fileExists(fileName),
      getDirectories: ts.sys.getDirectories,
      readDirectory: ts.sys.readDirectory,
      readFile: (fileName) => this.scripts.get(path.resolve(fileName))?.content ?? ts.sys.readFile(fileName),
      resolveModuleNames: (names, containingFile) => names.map((name) =>
        this.resolveModule(name, containingFile)),
    }
  }

  private resolveModule(name: string, containingFile: string): ts.ResolvedModule | undefined {
    if (!name.startsWith(".")) {
      const sdkRoot = discoverHarmonySdk().path
      const sdkModule = sdkRoot ? resolveHarmonySdkModule(sdkRoot, name) : null
      if (sdkModule) {
        return ({
          resolvedFileName: sdkModule,
          extension: sdkModule.endsWith(".d.ts") ? ts.Extension.Dts : ts.Extension.Ts,
          isExternalLibraryImport: true,
        } as ts.ResolvedModule)
      }
      return ts.resolveModuleName(name, containingFile, this.options, ts.sys).resolvedModule
    }
    const base = path.resolve(path.dirname(containingFile), name)
    const candidates = path.extname(base)
      ? [base]
      : [
          base + ".d.ets",
          base + ".d.ts",
          base + ".ets",
          base + ".ts",
          path.join(base, "index.d.ets"),
          path.join(base, "index.d.ts"),
          path.join(base, "index.ets"),
          path.join(base, "index.ts"),
        ]
    const resolved = candidates.find((candidate) =>
      this.scripts.has(path.resolve(candidate)) || fs.existsSync(candidate))
    return resolved
      ? ({ resolvedFileName: resolved, extension: ts.Extension.Ts } as ts.ResolvedModule)
      : undefined
  }

  private updateScript(filePath: string, content: string): void {
    const previous = this.scripts.get(filePath)
    if (previous?.sourceContent === content) {
      previous.lastAccess = ++this.accessClock
      return
    }
    if (previous) this.scriptBytes -= previous.bytes
    const virtualDocument = createArktsVirtualDocument(filePath, content)
    const bytes = Buffer.byteLength(content) + Buffer.byteLength(virtualDocument.generatedContent)
    this.scripts.set(filePath, {
      path: filePath,
      content: virtualDocument.generatedContent,
      sourceContent: content,
      virtualDocument,
      version: (previous?.version ?? 0) + 1,
      bytes,
      lastAccess: ++this.accessClock,
    })
    this.scriptBytes += bytes
    this.generation += 1
  }

  private removeScript(filePath: string): void {
    const previous = this.scripts.get(filePath)
    if (!previous) return
    this.scripts.delete(filePath)
    this.scriptBytes -= previous.bytes
    this.generation += 1
  }

  private mapCompletionEdits(
    currentPath: string,
    documentVersion: number | undefined,
    details: ts.CompletionEntryDetails,
  ): SemanticCompletionTextEdit[] | undefined {
    const action = details.codeActions?.find((candidate) =>
      !candidate.commands?.length
      && candidate.changes.length > 0
      && candidate.changes.every((change) =>
        !change.isNewFile && path.resolve(change.fileName) === currentPath))
    if (!action) return undefined
    const script = this.scripts.get(currentPath)
    if (!script) return undefined
    return action.changes.flatMap((change) => change.textChanges.map((textChange) => ({
      path: currentPath,
      range: script.virtualDocument.generatedSpanToSourceRange(
        textChange.span.start,
        textChange.span.length,
      ),
      newText: textChange.newText,
      expectedVersion: documentVersion,
    })))
  }

  private evict(protectedPaths: Set<string>): void {
    const candidates = [...this.scripts.values()]
      .filter((script) => !protectedPaths.has(script.path))
      .sort((left, right) => left.lastAccess - right.lastAccess)
    for (const script of candidates) {
      if (this.scripts.size <= MAX_SCRIPTS && this.scriptBytes <= MAX_SCRIPT_BYTES) break
      this.scripts.delete(script.path)
      this.scriptBytes -= script.bytes
      this.generation += 1
    }
  }
}

function typeStatus(filePath: string): SemanticTypeStatus {
  if (filePath.endsWith(".ets")) return "partial"
  if (filePath.endsWith(".ts")) return "ready"
  return "unsupported"
}

function hasCompletionPrefix(content: string, position: SemanticDocumentPosition): boolean {
  const offset = lineColumnToOffset(content, position.line, position.column)
  const before = content.slice(0, offset)
  return /\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(before)
    || before.endsWith(".")
    || /\b[A-Za-z_$][A-Za-z0-9_$]{2,}$/.test(before)
}

function completionPrefix(content: string, offset: number): string {
  return content.slice(0, offset).match(/[A-Za-z_$][A-Za-z0-9_$]*$/)?.[0] ?? ""
}

function completionKind(kind: ts.ScriptElementKind): string {
  if (kind === ts.ScriptElementKind.memberFunctionElement) return "method"
  if (kind === ts.ScriptElementKind.functionElement) return "function"
  if (kind === ts.ScriptElementKind.classElement) return "class"
  if (kind === ts.ScriptElementKind.interfaceElement) return "interface"
  if (kind === ts.ScriptElementKind.keyword) return "keyword"
  if (kind === ts.ScriptElementKind.constElement || kind === ts.ScriptElementKind.letElement) return "variable"
  return "property"
}

function typeDetail(entry: ts.CompletionEntry): string {
  const modifiers = entry.kindModifiers ? ` ${entry.kindModifiers}` : ""
  return `TypeScript ${entry.kind}${modifiers}`
}

function optionalDisplayParts(parts: ts.SymbolDisplayPart[]) {
  const value = ts.displayPartsToString(parts)
  return value || undefined
}

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

function unsupportedRename(reason: string): SemanticUnsupportedResult {
  return { status: "unsupported", reason }
}

function isWithinRoot(rootPath: string, filePath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath))
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function contentVersion(content: string) {
  let hash = 0xcbf29ce484222325n
  for (const byte of Buffer.from(content)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`
}

function compareTextEdits(
  left: { path: string; range: { startLine: number; startColumn: number } },
  right: { path: string; range: { startLine: number; startColumn: number } },
) {
  return left.path.localeCompare(right.path)
    || left.range.startLine - right.range.startLine
    || left.range.startColumn - right.range.startColumn
}

function isIdentifierText(value: string) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, value)
  return scanner.scan() === ts.SyntaxKind.Identifier
    && scanner.scan() === ts.SyntaxKind.EndOfFileToken
}
