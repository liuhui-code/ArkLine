import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"
import { SemanticDocumentStore } from "../workspace/document-store.js"

const tempRoots: string[] = []

function createDependencyFixture(unrelatedFileCount = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-semantic-session-"))
  tempRoots.push(root)
  const pages = path.join(root, "entry", "src", "main", "ets", "pages")
  const components = path.join(root, "entry", "src", "main", "ets", "components")
  const unrelated = path.join(root, "entry", "src", "main", "ets", "unrelated")
  fs.mkdirSync(pages, { recursive: true })
  fs.mkdirSync(components, { recursive: true })
  fs.mkdirSync(unrelated, { recursive: true })

  const dependencyPath = path.join(components, "Shared.ets")
  fs.writeFileSync(dependencyPath, "export function sharedSubmit() { return 1 }\n")
  for (let index = 0; index < unrelatedFileCount; index += 1) {
    fs.writeFileSync(path.join(unrelated, `Unused${index}.ets`), `export function unused${index}() {}\n`)
  }

  const currentPath = path.join(pages, "Index.ets")
  const content = [
    "import { sharedSubmit } from '../components/Shared'",
    "function render() {",
    "  sharedSubmit()",
    "}",
    "",
  ].join("\n")
  fs.writeFileSync(currentPath, content)
  return { currentPath, dependencyPath, content }
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("semantic workspace session", () => {
  it("restores hot document content at its durable generation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-semantic-replay-"))
    tempRoots.push(root)
    const documentPath = path.join(root, "Unsaved.ets")
    const content = "class ReplayTarget { replayMember = 1 }\nnew ReplayTarget().rep"
    const session = new SemanticWorkerSession()

    const restored = session.handle({
      id: "restore-1",
      method: "restoreDocuments",
      documents: [{ path: documentPath, content, contentGeneration: 7 }],
    })
    const completion = session.handle({
      id: "restore-query",
      method: "completion",
      position: { path: documentPath, line: 2, column: 23 },
    })

    expect(restored).toMatchObject({ ok: true, payload: { restoredDocumentCount: 1 } })
    expect(completion.ok).toBe(true)
    expect(completion.state).toMatchObject({ contentGeneration: 7, syntaxReady: true })
  })

  it("rejects conflicting or oversized document replay", () => {
    const session = new SemanticWorkerSession()
    const documentPath = path.join(os.tmpdir(), "ArkLineReplayConflict.ets")
    session.handle({
      id: "restore-initial",
      method: "restoreDocuments",
      documents: [{ path: documentPath, content: "one", contentGeneration: 2 }],
    })

    const conflict = session.handle({
      id: "restore-conflict",
      method: "restoreDocuments",
      documents: [{ path: documentPath, content: "two", contentGeneration: 2 }],
    })
    const oversized = session.handle({
      id: "restore-oversized",
      method: "restoreDocuments",
      documents: Array.from({ length: 33 }, (_, index) => ({
        path: `${documentPath}-${index}`,
        content: "content",
        contentGeneration: 1,
      })),
    })

    expect(conflict.ok).toBe(false)
    expect(conflict.error).toContain("changed content")
    expect(oversized.ok).toBe(false)
    expect(oversized.error).toContain("exceeds 32 documents")
  })

  it("loads only the active document and its import closure", () => {
    const { currentPath, dependencyPath, content } = createDependencyFixture(300)
    const response = new SemanticWorkerSession().handle({
      id: "closure-1",
      method: "gotoDefinition",
      position: { path: currentPath, line: 3, column: 5, content, contentGeneration: 1 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({ path: dependencyPath, line: 1, column: 17 })
    expect(response.state).toMatchObject({
      contentGeneration: 1,
      loadedDocumentCount: 2,
      syntaxReady: true,
    })
  })

  it("reuses documents and query results for an unchanged generation", () => {
    const { currentPath, content } = createDependencyFixture()
    const session = new SemanticWorkerSession()
    const request = {
      id: "cache-1",
      method: "completion" as const,
      position: { path: currentPath, line: 3, column: 5, content, contentGeneration: 7 },
    }

    const first = session.handle(request)
    const second = session.handle({ ...request, id: "cache-2" })

    expect(first.state?.queryCacheHit).toBe(false)
    expect(second.state).toMatchObject({
      contentGeneration: 7,
      documentCacheHit: true,
      queryCacheHit: true,
    })
  })

  it("rejects content older than the cached document generation", () => {
    const { currentPath, content } = createDependencyFixture()
    const session = new SemanticWorkerSession()
    session.handle({
      id: "generation-new",
      method: "completion",
      position: { path: currentPath, line: 3, column: 5, content, contentGeneration: 9 },
    })

    const stale = session.handle({
      id: "generation-old",
      method: "completion",
      position: { path: currentPath, line: 3, column: 5, content, contentGeneration: 8 },
    })

    expect(stale.ok).toBe(false)
    expect(stale.error).toContain("Stale semantic document generation")
  })

  it("invalidates cached queries when an imported dependency changes", () => {
    const { currentPath, dependencyPath, content } = createDependencyFixture()
    const session = new SemanticWorkerSession()
    const position = { path: currentPath, line: 3, column: 5, content, contentGeneration: 3 }
    const first = session.handle({ id: "dependency-1", method: "gotoDefinition", position })
    fs.writeFileSync(dependencyPath, "\nexport function sharedSubmit() { return 22 }\n")
    const second = session.handle({ id: "dependency-2", method: "gotoDefinition", position })

    expect(first.payload).toMatchObject({ line: 1 })
    expect(second.payload).toMatchObject({ line: 2 })
    expect(second.state?.dependencyGeneration).toBeGreaterThan(first.state?.dependencyGeneration ?? 0)
    expect(second.state?.queryCacheHit).toBe(false)
  })

  it("keeps semantic queries bounded when the workspace has many unrelated files", () => {
    const { currentPath, content } = createDependencyFixture(1_000)
    const syntaxStarted = performance.now()
    const syntaxView = new SemanticDocumentStore().prepare({
      path: currentPath,
      line: 3,
      column: 5,
      content,
      contentGeneration: 1,
    })
    const syntaxDuration = performance.now() - syntaxStarted
    const session = new SemanticWorkerSession()
    const definitionStarted = performance.now()
    const definition = session.handle({
      id: "performance-definition",
      method: "gotoDefinition",
      position: { path: currentPath, line: 3, column: 5, content, contentGeneration: 1 },
    })
    const definitionDuration = performance.now() - definitionStarted
    const completionDurations = Array.from({ length: 20 }, (_, index) => {
      const started = performance.now()
      session.handle({
        id: `performance-completion-${index}`,
        method: "completion",
        position: { path: currentPath, line: 3, column: 5, content, contentGeneration: 1 },
      })
      return performance.now() - started
    }).sort((left, right) => left - right)
    const completionP95 = completionDurations[Math.floor(completionDurations.length * 0.95)] ?? Infinity

    expect(definition.ok).toBe(true)
    expect(syntaxView.state.loadedDocumentCount).toBe(2)
    expect(definition.state?.loadedDocumentCount).toBe(2)
    expect(syntaxDuration).toBeLessThan(100)
    expect(definitionDuration).toBeLessThan(200)
    expect(completionP95).toBeLessThan(150)
  })
})
