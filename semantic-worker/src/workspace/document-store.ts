import fs from "node:fs"
import path from "node:path"

import type {
  SemanticDocumentPosition,
  SemanticReplayDocument,
  SemanticResponseState,
} from "../protocol.js"
import { resolveWorkspaceRoot, type WorkspaceDocument } from "../sdk/workspace-loader.js"

const MAX_CACHED_DOCUMENTS = 512
const MAX_CACHED_BYTES = 16 * 1024 * 1024
const MAX_CLOSURE_DOCUMENTS = 256
const MAX_CLOSURE_BYTES = 8 * 1024 * 1024
const SOURCE_EXTENSIONS = [".ets", ".ts"]
const MAX_REPLAY_DOCUMENTS = 32
const MAX_REPLAY_BYTES = 4 * 1024 * 1024

interface DocumentRecord extends WorkspaceDocument {
  contentGeneration: number
  diskFingerprint: string | null
  lastAccess: number
  available: boolean
}

export interface SemanticWorkspaceView {
  rootPath: string
  documents: WorkspaceDocument[]
  state: SemanticResponseState
}

export class SemanticDocumentStore {
  private readonly documents = new Map<string, DocumentRecord>()
  private readonly dependencyGenerations = new Map<string, number>()
  private accessClock = 0
  private cachedBytes = 0

  restore(documents: SemanticReplayDocument[]): number {
    if (documents.length > MAX_REPLAY_DOCUMENTS) {
      throw new Error(`Semantic replay exceeds ${MAX_REPLAY_DOCUMENTS} documents`)
    }
    const totalBytes = documents.reduce((total, document) => total + Buffer.byteLength(document.content), 0)
    if (totalBytes > MAX_REPLAY_BYTES) {
      throw new Error(`Semantic replay exceeds ${MAX_REPLAY_BYTES} bytes`)
    }
    for (const document of documents) {
      if (document.contentGeneration < 1) {
        throw new Error(`Semantic replay generation must be positive for ${document.path}`)
      }
      this.loadCurrent(path.resolve(document.path), {
        path: document.path,
        line: 1,
        column: 1,
        content: document.content,
        contentGeneration: document.contentGeneration,
      })
    }
    return documents.length
  }

  prepare(position: SemanticDocumentPosition): SemanticWorkspaceView {
    const currentPath = path.resolve(position.path)
    const rootPath = position.workspaceRoot
      ? path.resolve(position.workspaceRoot)
      : resolveWorkspaceRoot(currentPath)
    const previousCurrent = this.documents.get(currentPath)
    const current = this.loadCurrent(currentPath, position)
    const closure = this.collectDependencyClosure(current, previousCurrent === current)
    const documentCacheHit = closure.every(({ cacheHit }) => cacheHit)
    const documents = closure.map(({ record }) => ({ path: record.path, content: record.content }))
    const dependencyGeneration = this.updateDependencyGeneration(rootPath, closure)
    this.evict(currentPath, new Set(documents.map((document) => document.path)))

    return {
      rootPath,
      documents,
      state: {
        path: currentPath,
        contentGeneration: current.contentGeneration,
        dependencyGeneration,
        documentCacheHit,
        queryCacheHit: false,
        loadedDocumentCount: documents.length,
        syntaxReady: current.available,
      },
    }
  }

  private loadCurrent(filePath: string, position: SemanticDocumentPosition): DocumentRecord {
    const cached = this.documents.get(filePath)
    const requestedGeneration = position.contentGeneration
    if (cached && requestedGeneration !== undefined && requestedGeneration < cached.contentGeneration) {
      throw new Error(
        `Stale semantic document generation for ${filePath}: ${requestedGeneration} < ${cached.contentGeneration}`,
      )
    }

    if (position.content !== undefined) {
      if (cached && requestedGeneration === cached.contentGeneration && position.content !== cached.content) {
        throw new Error(`Semantic document generation ${requestedGeneration} changed content for ${filePath}`)
      }
      if (cached && position.content === cached.content) {
        cached.lastAccess = ++this.accessClock
        return cached
      }
      const generation = requestedGeneration ?? ((cached?.contentGeneration ?? 0) + 1)
      return this.store(filePath, position.content, generation, null, true)
    }

    return this.loadFromDisk(filePath, cached)
  }

  private loadFromDisk(filePath: string, cached?: DocumentRecord): DocumentRecord {
    const stat = safeStat(filePath)
    const fingerprint = stat ? `${stat.mtimeMs}:${stat.size}` : null
    if (cached && fingerprint !== null && cached.diskFingerprint === fingerprint) {
      cached.lastAccess = ++this.accessClock
      return cached
    }
    const content = safeRead(filePath)
    if (content === null) {
      if (cached) return cached
      return this.store(filePath, "", 1, fingerprint, false)
    }
    return this.store(filePath, content, (cached?.contentGeneration ?? 0) + 1, fingerprint, true)
  }

  private collectDependencyClosure(current: DocumentRecord, currentCacheHit: boolean) {
    const result: Array<{ record: DocumentRecord; cacheHit: boolean }> = [
      { record: current, cacheHit: currentCacheHit },
    ]
    const queued = [current]
    const visited = new Set([current.path])
    let totalBytes = Buffer.byteLength(current.content)

    while (queued.length > 0 && result.length < MAX_CLOSURE_DOCUMENTS) {
      const source = queued.shift()
      if (!source) break
      for (const dependencyPath of resolveRelativeImports(source.path, source.content)) {
        if (visited.has(dependencyPath)) continue
        visited.add(dependencyPath)
        const before = this.documents.get(dependencyPath)
        const dependency = this.loadFromDisk(dependencyPath, before)
        const bytes = Buffer.byteLength(dependency.content)
        if (totalBytes + bytes > MAX_CLOSURE_BYTES) continue
        totalBytes += bytes
        result.push({ record: dependency, cacheHit: before === dependency })
        queued.push(dependency)
        if (result.length >= MAX_CLOSURE_DOCUMENTS) break
      }
    }
    return result
  }

  private store(
    filePath: string,
    content: string,
    contentGeneration: number,
    diskFingerprint: string | null,
    available: boolean,
  ): DocumentRecord {
    const previous = this.documents.get(filePath)
    if (previous) this.cachedBytes -= Buffer.byteLength(previous.content)
    const record = {
      path: filePath,
      content,
      contentGeneration,
      diskFingerprint,
      lastAccess: ++this.accessClock,
      available,
    }
    this.documents.set(filePath, record)
    this.cachedBytes += Buffer.byteLength(content)
    return record
  }

  private updateDependencyGeneration(
    rootPath: string,
    closure: Array<{ record: DocumentRecord; cacheHit: boolean }>,
  ): number {
    const previous = this.dependencyGenerations.get(rootPath) ?? 0
    const changedDependency = closure.slice(1).some(({ cacheHit }) => !cacheHit)
    const next = previous === 0 || changedDependency ? previous + 1 : previous
    this.dependencyGenerations.set(rootPath, next)
    return next
  }

  private evict(currentPath: string, protectedPaths: Set<string>): void {
    if (this.documents.size <= MAX_CACHED_DOCUMENTS && this.cachedBytes <= MAX_CACHED_BYTES) return
    const candidates = [...this.documents.values()]
      .filter((record) => record.path !== currentPath && !protectedPaths.has(record.path))
      .sort((left, right) => left.lastAccess - right.lastAccess)
    for (const record of candidates) {
      if (this.documents.size <= MAX_CACHED_DOCUMENTS && this.cachedBytes <= MAX_CACHED_BYTES) break
      this.documents.delete(record.path)
      this.cachedBytes -= Buffer.byteLength(record.content)
    }
  }
}

function resolveRelativeImports(documentPath: string, content: string): string[] {
  const specifiers = [...content.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => Boolean(specifier?.startsWith(".")))
  return specifiers.flatMap((specifier) => resolveImportPath(documentPath, specifier))
}

function resolveImportPath(documentPath: string, specifier: string): string[] {
  const basePath = path.resolve(path.dirname(documentPath), specifier)
  const candidates = path.extname(basePath)
    ? [basePath]
    : [
        ...SOURCE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
        ...SOURCE_EXTENSIONS.map((extension) => path.join(basePath, `index${extension}`)),
      ]
  return candidates.filter((candidate, index) => index === candidates.findIndex((value) => value === candidate))
    .filter((candidate) => safeStat(candidate)?.isFile())
    .slice(0, 1)
}

function safeRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath)
  } catch {
    return null
  }
}
