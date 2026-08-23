import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"
import { SemanticTypeEngineRegistry } from "../types/type-engine.js"
import { SemanticDocumentStore } from "../workspace/document-store.js"
import { readCallContext } from "../features/signature-help.js"

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
      "function navigateHome() {}\nconst user = { name: 'Ada', age: 1 }\nuser.na\n",
    )

    const response = new SemanticWorkerSession().handle({
      id: "type-completion",
      method: "completion",
      position: { path: filePath, line: 3, column: 8 },
    })

    expect(response.ok).toBe(true)
    expect(response.state).toMatchObject({
      typeStatus: "ready",
      typeEngine: "typescript-language-service",
    })
    expect(response.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "name", source: "type", kind: "property" }),
    ]))
    expect(response.payload).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "navigateHome()", source: "workspace" }),
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

  it("finds typed property usages across files without matching unrelated names", () => {
    const root = createRoot("usages")
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
    const unrelatedPath = createFile(root, "Unrelated.ts", "const name = 'not-a-user-property'\n")

    const response = new SemanticWorkerSession().handle({
      id: "type-usages",
      method: "findUsages",
      position: { path: modelPath, line: 2, column: 3 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual([
      expect.objectContaining({ path: indexPath, line: 3, column: 6, confidence: "exact" }),
    ])
    expect(response.payload).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: unrelatedPath }),
    ]))
  })

  it("returns source-mapped TypeScript diagnostics through the worker protocol", () => {
    const root = createRoot("diagnostics")
    const filePath = createFile(root, "Index.ts", "const value: string = 42\n")

    const response = new SemanticWorkerSession().handle({
      id: "type-diagnostics",
      method: "diagnostics",
      position: { path: filePath, line: 1, column: 1 },
    })

    expect(response.ok).toBe(true)
    expect(response.state?.typeStatus).toBe("ready")
    expect(response.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "language",
        severity: "error",
        path: filePath,
        line: 1,
        message: expect.stringContaining("not assignable to type 'string'"),
      }),
    ]))
  })

  it("builds a versioned cross-file rename plan without writing files", () => {
    const root = createRoot("rename")
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
    const beforeModel = fs.readFileSync(modelPath, "utf8")
    const beforeIndex = fs.readFileSync(indexPath, "utf8")

    const response = new SemanticWorkerSession().handle({
      id: "type-rename",
      method: "rename",
      position: { path: modelPath, line: 2, column: 3, workspaceRoot: root },
      newName: "displayName",
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual(expect.objectContaining({
      title: "Rename name to displayName",
      affectedFiles: [indexPath, modelPath],
      requiresPreview: true,
      operations: expect.arrayContaining([
        expect.objectContaining({ kind: "text", path: modelPath, newText: "displayName" }),
        expect.objectContaining({ kind: "text", path: indexPath, newText: "displayName" }),
      ]),
    }))
    const payload = response.payload
    const operations = payload && "operations" in payload
      ? payload.operations
      : []
    expect(operations).toHaveLength(2)
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ expectedContentVersion: expect.stringMatching(/^fnv1a64:/) }),
    ]))
    expect(fs.readFileSync(modelPath, "utf8")).toBe(beforeModel)
    expect(fs.readFileSync(indexPath, "utf8")).toBe(beforeIndex)
  })

  it("returns TypeScript signature help with the active argument", () => {
    const root = createRoot("signature-help")
    const filePath = createFile(
      root,
      "Index.ts",
      "function add(left: number, right: number): number { return left + right }\nadd(1, \n",
    )

    const response = new SemanticWorkerSession().handle({
      id: "type-signature-help",
      method: "signatureHelp",
      position: { path: filePath, line: 2, column: 7 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual(expect.objectContaining({ activeParameter: 1 }))
    expect(response.payload).toEqual(expect.objectContaining({
      signatures: expect.arrayContaining([
        expect.objectContaining({ label: expect.stringContaining("add(left: number, right: number): number") }),
      ]),
    }))
  })

  it("reads ArkUI call context without mistaking nested arguments for parameters", () => {
    const content = "Column().width(Length.vp(12), "
    expect(readCallContext(content, { path: "x.ets", line: 1, column: content.length + 1 }))
      .toMatchObject({ name: "width", component: "Column", isChain: true, argumentIndex: 1 })
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

  it("maps one-line ArkTS completion positions into the virtual document", () => {
    const root = createRoot("arkts-source-map-completion")
    const content = "struct Screen { title: string = ''; render() { this.ti } }\n"
    const filePath = createFile(root, "Screen.ets", content)
    const cursor = content.indexOf("this.ti") + "this.ti".length

    const response = new SemanticWorkerSession().handle({
      id: "arkts-source-map-completion",
      method: "completion",
      position: { path: filePath, line: 1, column: cursor + 1 },
    })

    expect(response.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "title",
        source: "type",
      }),
    ]))
  })

  it("maps one-line ArkTS definition targets back to source columns", () => {
    const root = createRoot("arkts-source-map-definition")
    const model = "export struct User { name: string }\n"
    const modelPath = createFile(root, "Model.ets", model)
    const indexPath = createFile(
      root,
      "Index.ets",
      "import type { User } from './Model'\nconst user = {} as User\nuser.name\n",
    )

    const response = new SemanticWorkerSession().handle({
      id: "arkts-source-map-definition",
      method: "gotoDefinition",
      position: { path: indexPath, line: 3, column: 7 },
    })

    expect(response.payload).toEqual({
      path: modelPath,
      line: 1,
      column: model.indexOf("name") + 1,
    })
  })

  it("resolves ArkTS auto-import edits back to source coordinates", () => {
    const root = createRoot("arkts-auto-import")
    createFile(
      root,
      "Model.ets",
      "export class Existing {}\n/** A reusable widget. */\nexport class Widget {}\n",
    )
    const content = [
      "import { Existing } from './Model'",
      "struct Screen {",
      "  value: Existing = new Existing()",
      "  render() { Wid }",
      "}",
      "",
    ].join("\n")
    const filePath = createFile(root, "Screen.ets", content)
    const session = new SemanticWorkerSession()
    const position = { path: filePath, line: 4, column: 17 }
    const completion = session.handle({
      id: "arkts-auto-import-list",
      method: "completion",
      position,
    })
    const item = Array.isArray(completion.payload)
      ? completion.payload.find((candidate) => "label" in candidate && candidate.label === "Widget")
      : undefined

    expect(item).toBeDefined()
    const resolved = session.handle({
      id: "arkts-auto-import-resolve",
      method: "resolveCompletion",
      position,
      completion: item && "label" in item ? item : undefined,
    })

    expect(resolved.payload).toEqual(expect.objectContaining({
      label: "Widget",
      documentation: expect.any(String),
      additionalTextEdits: [expect.objectContaining({
        path: filePath,
        range: {
          startLine: 1,
          startColumn: 18,
          endLine: 1,
          endColumn: 18,
        },
        newText: ", Widget",
      })],
    }))
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
