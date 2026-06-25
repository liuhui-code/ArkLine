import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"

const tempRoots: string[] = []

function createWorkspaceFixture(name: string, fileName = "Index.ets"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `arkline-worker-actions-${name}-`))
  tempRoots.push(root)

  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  fs.mkdirSync(pagesDir, { recursive: true })

  const filePath = path.join(pagesDir, fileName)
  fs.writeFileSync(filePath, "@Entry\n@Component\nstruct Index {}\n")

  return filePath
}

function snapshotTree(root: string): Map<string, string> {
  const entries = new Map<string, string>()

  function walk(current: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      const relativePath = path.relative(root, entryPath)

      if (entry.isDirectory()) {
        entries.set(relativePath, "<dir>")
        walk(entryPath)
      } else {
        entries.set(relativePath, fs.readFileSync(entryPath, "utf8"))
      }
    }
  }

  walk(root)
  return entries
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("semantic worker code actions", () => {
  it("lists deterministic ArkTS actions for an .ets file", () => {
    const session = new SemanticWorkerSession()
    const filePath = createWorkspaceFixture("ets-actions")

    const response = session.handle({
      id: "actions-1",
      method: "listCodeActions",
      position: {
        path: filePath,
        line: 1,
        column: 1,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      actions: [
        {
          id: "arkts.generate.page",
          title: "Generate ArkTS Page",
          kind: "generate",
          provider: "template",
          safety: "needsPreview",
          data: { template: "arkts-page", currentPath: filePath, name: "GeneratedPage" },
        },
        {
          id: "arkts.generate.component",
          title: "Generate ArkTS Component",
          kind: "generate",
          provider: "template",
          safety: "needsPreview",
          data: { template: "arkts-component", currentPath: filePath, name: "GeneratedComponent" },
        },
        {
          id: "workspace.renameFile",
          title: "Rename File",
          kind: "source",
          provider: "workspace",
          safety: "needsPreview",
          data: { currentPath: filePath, targetPath: expect.stringContaining("IndexRenamed.ets") },
        },
      ],
    })
  })

  it("resolves Generate ArkTS Page to a create-file workspace edit plan", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "actions-page",
      method: "resolveCodeAction",
      action: {
        id: "arkts.generate.page",
        data: {
          name: "Home",
          targetPath: "src/pages/Home.ets",
        },
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      id: "arkts.generate.page",
      title: "Generate ArkTS Page",
      operations: [
        {
          kind: "createFile",
          path: "src/pages/Home.ets",
          content: [
            "@Entry",
            "@Component",
            "struct Home {",
            "  build() {",
            "  }",
            "}",
            "",
          ].join("\n"),
          overwrite: false,
        },
      ],
      conflicts: [],
      affectedFiles: ["src/pages/Home.ets"],
      undoLabel: "Remove generated ArkTS page",
      requiresPreview: true,
    })
  })

  it("resolves Generate ArkTS Component to a create-file workspace edit plan", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "actions-component",
      method: "resolveCodeAction",
      action: {
        id: "arkts.generate.component",
        data: {
          name: "UserCard",
          currentPath: "src/pages/Index.ets",
        },
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toMatchObject({
      id: "arkts.generate.component",
      title: "Generate ArkTS Component",
      operations: [
        {
          kind: "createFile",
          path: "src/components/UserCard.ets",
          content: [
            "@Component",
            "struct UserCard {",
            "  build() {",
            "  }",
            "}",
            "",
          ].join("\n"),
          overwrite: false,
        },
      ],
      affectedFiles: ["src/components/UserCard.ets"],
      requiresPreview: true,
    })
  })

  it("keeps ArkTS module prefixes when inferring generated target directories", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "actions-page-inferred",
      method: "resolveCodeAction",
      action: {
        id: "arkts.generate.page",
        data: {
          name: "Home",
          currentPath: "entry/src/main/ets/Foo.ets",
        },
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toMatchObject({
      operations: [
        {
          kind: "createFile",
          path: "entry/src/main/ets/pages/Home.ets",
        },
      ],
      affectedFiles: ["entry/src/main/ets/pages/Home.ets"],
    })
  })

  it("resolves Rename File to a rename-file workspace edit plan", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "actions-rename",
      method: "resolveCodeAction",
      action: {
        id: "workspace.renameFile",
        data: {
          currentPath: "src/pages/Old.ets",
          targetPath: "src/pages/New.ets",
        },
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toMatchObject({
      id: "workspace.renameFile.src/pages/Old.ets",
      title: "Rename src/pages/Old.ets to src/pages/New.ets",
      operations: [
        {
          kind: "renameFile",
          oldPath: "src/pages/Old.ets",
          newPath: "src/pages/New.ets",
          overwrite: false,
        },
      ],
      affectedFiles: ["src/pages/Old.ets", "src/pages/New.ets"],
      undoLabel: "Rename src/pages/New.ets back to src/pages/Old.ets",
      requiresPreview: true,
    })
  })

  it("returns an empty action list for unsupported file types", () => {
    const session = new SemanticWorkerSession()
    const filePath = createWorkspaceFixture("unsupported-actions", "README.md")

    const response = session.handle({
      id: "actions-2",
      method: "listCodeActions",
      position: {
        path: filePath,
        line: 1,
        column: 1,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({ actions: [] })
  })

  it("continues returning structured errors for unsupported methods", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "unsupported-1",
      method: "unknownMethod",
    } as never)

    expect(response).toEqual({
      id: "unsupported-1",
      ok: false,
      payload: null,
      error: "Unsupported method: unknownMethod",
    })
  })

  it("does not write files when listing or resolving code actions", () => {
    const session = new SemanticWorkerSession()
    const filePath = createWorkspaceFixture("no-side-effects")
    const root = tempRoots.at(-1)
    if (root === undefined) {
      throw new Error("Expected fixture root")
    }
    const before = snapshotTree(root)

    const listResponse = session.handle({
      id: "actions-3",
      method: "listCodeActions",
      position: {
        path: filePath,
        line: 1,
        column: 1,
      },
    })
    const resolveResponse = session.handle({
      id: "actions-4",
      method: "resolveCodeAction",
      action: {
        id: "workspace.renameFile",
        data: {
          currentPath: filePath,
          targetPath: filePath.replace(/Index\.ets$/, "IndexRenamed.ets"),
        },
      },
    })
    const renameResponse = session.handle({
      id: "actions-5",
      method: "rename",
      position: {
        path: filePath,
        line: 1,
        column: 1,
      },
      newName: "Renamed",
    })

    expect(listResponse.ok).toBe(true)
    expect(resolveResponse.payload).toMatchObject({ id: expect.stringContaining("workspace.renameFile") })
    expect(renameResponse.payload).toMatchObject({ status: "unsupported" })
    expect(snapshotTree(root)).toEqual(before)
  })
})
