import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"
import { SemanticTypeEngineRegistry } from "../types/type-engine.js"
import { SemanticDocumentStore } from "../workspace/document-store.js"

const tempRoots: string[] = []

function createFile(root: string, name: string, content: string): string {
  const filePath = path.join(root, name)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
  return filePath
}

function createRoot(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `arkline-type-${name}-`))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("incremental semantic type engine", () => {
  it("completes members from inferred TypeScript types", () => {
    const root = createRoot("completion")
    const filePath = createFile(
      root,
      "Index.ts",
      "const user = { name: 'Ada', age: 1 }\nuser.na\n",
    )

    const response = new SemanticWorkerSession().handle({
      id: "type-completion",
      method: "completion",
      position: { path: filePath, line: 2, column: 8 },
    })

    expect(response.ok).toBe(true)
    expect(response.state).toMatchObject({
      typeStatus: "ready",
      typeEngine: "typescript-language-service",
    })
    expect(response.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "name", source: "type", kind: "property" }),
    ]))
  })

  it("resolves a typed property declaration across files", () => {
    const root = createRoot("definition")
    const modelPath = createFile(
      root,
      "Model.ts",
      "export interface User {\n  name: string\n}\n",
    )
    const indexPath = createFile(
      root,
      "Index.ts",
      "import type { User } from './Model'\nconst user = {} as User\nuser.name\n",
    )

    const response = new SemanticWorkerSession().handle({
      id: "type-definition",
      method: "gotoDefinition",
      position: { path: indexPath, line: 3, column: 7 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({ path: modelPath, line: 2, column: 3 })
  })

  it("keeps ArkTS type evidence partial while providing adapted member completion", () => {
    const root = createRoot("arkts")
    const filePath = createFile(
      root,
      "Index.ets",
      [
        "struct Index {",
        "  title: string = ''",
        "  render() {",
        "    this.ti",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = new SemanticWorkerSession().handle({
      id: "arkts-type-completion",
      method: "completion",
      position: { path: filePath, line: 4, column: 12 },
    })

    expect(response.state?.typeStatus).toBe("partial")
    expect(response.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "title", source: "type" }),
    ]))
  })

  it("increments the type generation only when a dependency changes", () => {
    const root = createRoot("generation")
    const modelPath = createFile(root, "Model.ts", "export interface User { name: string }\n")
    const indexPath = createFile(
      root,
      "Index.ts",
      "import type { User } from './Model'\nconst user = {} as User\nuser.\n",
    )
    const session = new SemanticWorkerSession()
    const position = { path: indexPath, line: 3, column: 6 }

    const first = session.handle({ id: "type-generation-1", method: "completion", position })
    const unchanged = session.handle({ id: "type-generation-2", method: "completion", position })
    fs.writeFileSync(modelPath, "export interface User { name: string; age: number }\n")
    const changed = session.handle({ id: "type-generation-3", method: "completion", position })

    expect(unchanged.state?.typeGeneration).toBe(first.state?.typeGeneration)
    expect(unchanged.state?.queryCacheHit).toBe(true)
    expect(changed.state?.typeGeneration).toBeGreaterThan(first.state?.typeGeneration ?? 0)
    expect(changed.state?.queryCacheHit).toBe(false)
    expect(changed.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "age", source: "type" }),
    ]))
  })

  it("bounds persistent workspace engines with LRU eviction", () => {
    const registry = new SemanticTypeEngineRegistry()
    for (let index = 0; index < 6; index += 1) {
      const root = createRoot(`lru-${index}`)
      const filePath = createFile(root, "Index.ts", `export const value${index} = ${index}\n`)
      const workspace = new SemanticDocumentStore().prepare({
        path: filePath,
        line: 1,
        column: 1,
        workspaceRoot: root,
      })
      registry.prepare(workspace)
    }

    expect(registry.workspaceCount()).toBe(4)
    registry.dispose()
  })
})
