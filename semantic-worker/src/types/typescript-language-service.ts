import fs from "node:fs"
import path from "node:path"

import ts from "typescript"

import type {
  SemanticCompletionItem,
  SemanticDefinitionCandidate,
  SemanticDocumentPosition,
} from "../protocol.js"
import type { SemanticWorkspaceView } from "../workspace/document-store.js"
import type { SemanticTypeEngineState, SemanticTypeStatus } from "./type-engine.js"
import { lineColumnToOffset, offsetToLineColumn, spanToRange } from "./text-position.js"

const MAX_SCRIPTS = 512
const MAX_SCRIPT_BYTES = 16 * 1024 * 1024
const MAX_COMPLETIONS = 128
const ENGINE_VERSION = `typescript-${ts.version}-arkts-v1`

interface ScriptRecord {
  path: string
  content: string
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
    for (const document of workspace.documents) {
      const filePath = path.resolve(document.path)
      protectedPaths.add(filePath)
      this.updateScript(filePath, transformArkts(filePath, document.content))
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
    if (!script || !hasCompletionPrefix(script.content, position)) return []
    script.lastAccess = ++this.accessClock
    const offset = lineColumnToOffset(script.content, position.line, position.column)
    const info = this.service.getCompletionsAtPosition(filePath, offset, {
      includeCompletionsForImportStatements: true,
      includeCompletionsWithInsertText: true,
    })
    if (!info) return []
    return info.entries.slice(0, MAX_COMPLETIONS).map((entry) => ({
      label: entry.name,
      detail: typeDetail(entry),
      kind: completionKind(entry.kind),
      insertText: entry.insertText,
      filterText: entry.filterText,
      sortText: entry.sortText,
      source: "type",
      replacementRange: entry.replacementSpan
        ? spanToRange(script.content, entry.replacementSpan.start, entry.replacementSpan.length)
        : undefined,
      data: { provider: "typescript", engineVersion: ENGINE_VERSION },
    }))
  }

  define(position: SemanticDocumentPosition): SemanticDefinitionCandidate[] {
    const filePath = path.resolve(position.path)
    const script = this.scripts.get(filePath)
    if (!script) return []
    script.lastAccess = ++this.accessClock
    const offset = lineColumnToOffset(script.content, position.line, position.column)
    const definitions = this.service.getDefinitionAtPosition(filePath, offset) ?? []
    const seen = new Set<string>()
    return definitions.flatMap((definition) => {
      const targetPath = path.resolve(definition.fileName)
      const content = this.scripts.get(targetPath)?.content ?? safeRead(targetPath)
      if (content === null) return []
      const target = offsetToLineColumn(content, definition.textSpan.start)
      const key = `${targetPath}:${target.line}:${target.column}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ path: targetPath, line: target.line, column: target.column }]
    })
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
      return ts.resolveModuleName(name, containingFile, this.options, ts.sys).resolvedModule
    }
    const base = path.resolve(path.dirname(containingFile), name)
    const candidates = path.extname(base)
      ? [base]
      : [base + ".ets", base + ".ts", path.join(base, "index.ets"), path.join(base, "index.ts")]
    const resolved = candidates.find((candidate) =>
      this.scripts.has(path.resolve(candidate)) || fs.existsSync(candidate))
    return resolved
      ? ({ resolvedFileName: resolved, extension: ts.Extension.Ts } as ts.ResolvedModule)
      : undefined
  }

  private updateScript(filePath: string, content: string): void {
    const previous = this.scripts.get(filePath)
    if (previous?.content === content) {
      previous.lastAccess = ++this.accessClock
      return
    }
    if (previous) this.scriptBytes -= previous.bytes
    const bytes = Buffer.byteLength(content)
    this.scripts.set(filePath, {
      path: filePath,
      content,
      version: (previous?.version ?? 0) + 1,
      bytes,
      lastAccess: ++this.accessClock,
    })
    this.scriptBytes += bytes
    this.generation += 1
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

function transformArkts(filePath: string, content: string): string {
  return filePath.endsWith(".ets")
    ? content.replace(/\bstruct(?=\s+[A-Za-z_$])/g, "class ")
    : content
}

function typeStatus(filePath: string): SemanticTypeStatus {
  if (filePath.endsWith(".ets")) return "partial"
  if (filePath.endsWith(".ts")) return "ready"
  return "unsupported"
}

function hasCompletionPrefix(content: string, position: SemanticDocumentPosition): boolean {
  const offset = lineColumnToOffset(content, position.line, position.column)
  const before = content.slice(0, offset)
  return /\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(before) || before.endsWith(".")
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

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}
