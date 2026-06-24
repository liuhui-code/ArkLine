import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"

const tempRoots: string[] = []

function createWorkspaceFixture(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `arkline-worker-${name}-`))
  tempRoots.push(root)

  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  const componentsDir = path.join(root, "entry", "src", "main", "ets", "components")
  fs.mkdirSync(pagesDir, { recursive: true })
  fs.mkdirSync(componentsDir, { recursive: true })

  fs.writeFileSync(
    path.join(componentsDir, "Shared.ets"),
    "export function sharedSubmit() {\n  return 1;\n}\n",
  )
  const indexPath = path.join(pagesDir, "Index.ets")
  fs.writeFileSync(
    indexPath,
    "@Entry\n@Component\nstruct Index {}\n",
  )

  return indexPath
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("semantic worker completion", () => {
  it("returns an empty completion list by default", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "completion-1",
      method: "completion",
      position: {
        path: "/tmp/entry/src/main/ets/pages/Index.ets",
        line: 1,
        column: 1,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual([])
  })

  it("includes workspace symbols in completion results", () => {
    const session = new SemanticWorkerSession()
    const indexPath = createWorkspaceFixture("cross-file-completion")

    const response = session.handle({
      id: "completion-2",
      method: "completion",
      position: {
        path: indexPath,
        line: 1,
        column: 1,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual([
      { label: "@Entry", detail: "ArkTS decorator", kind: "keyword" },
      { label: "@Component", detail: "ArkTS decorator", kind: "keyword" },
      { label: "build()", detail: "Component lifecycle method", kind: "method" },
      { label: "sharedSubmit()", detail: "Semantic workspace function", kind: "function" },
    ])
  })
})
