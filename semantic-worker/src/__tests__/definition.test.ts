import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"

const tempRoots: string[] = []
const previousSdkPath = process.env.ARKLINE_HARMONY_SDK_PATH

function createWorkspaceFixture(name: string): {
  indexPath: string
  sharedPath: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `arkline-worker-${name}-`))
  tempRoots.push(root)

  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  const componentsDir = path.join(root, "entry", "src", "main", "ets", "components")
  fs.mkdirSync(pagesDir, { recursive: true })
  fs.mkdirSync(componentsDir, { recursive: true })

  const sharedPath = path.join(componentsDir, "Shared.ets")
  const indexPath = path.join(pagesDir, "Index.ets")

  fs.writeFileSync(
    sharedPath,
    "export function sharedSubmit() {\n  return 1;\n}\n",
  )
  fs.writeFileSync(
    indexPath,
    "import { sharedSubmit } from '../components/Shared';\n\nfunction buildPage() {\n  sharedSubmit();\n}\n",
  )

  return { indexPath, sharedPath }
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
  if (previousSdkPath === undefined) {
    delete process.env.ARKLINE_HARMONY_SDK_PATH
  } else {
    process.env.ARKLINE_HARMONY_SDK_PATH = previousSdkPath
  }
})

describe("semantic worker lifecycle", () => {
  it("responds to health checks", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "health-1",
      method: "health",
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({ status: "ready" })
  })

  it("returns a null definition placeholder by default", () => {
    const session = new SemanticWorkerSession()

    const response = session.handle({
      id: "definition-1",
      method: "gotoDefinition",
      position: {
        path: "/tmp/entry/src/main/ets/pages/Index.ets",
        line: 4,
        column: 8,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toBeNull()
  })

  it("resolves a definition in another workspace file", () => {
    const session = new SemanticWorkerSession()
    const { indexPath, sharedPath } = createWorkspaceFixture("cross-file-definition")

    const response = session.handle({
      id: "definition-2",
      method: "gotoDefinition",
      position: {
        path: indexPath,
        line: 4,
        column: 5,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      path: sharedPath,
      line: 1,
      column: 17,
    })
  })

  it("prefers the current document when the same symbol exists in multiple files", () => {
    const session = new SemanticWorkerSession()
    const { indexPath } = createWorkspaceFixture("same-file-priority")
    const siblingPath = path.join(path.dirname(indexPath), "Sibling.ets")

    fs.writeFileSync(
      siblingPath,
      "function sharedSubmit() {\n  return 2;\n}\n",
    )

    fs.writeFileSync(
      indexPath,
      "function sharedSubmit() {\n  return 1;\n}\n\nfunction buildPage() {\n  sharedSubmit();\n}\n",
    )

    const response = session.handle({
      id: "definition-3",
      method: "gotoDefinition",
      position: {
        path: indexPath,
        line: 6,
        column: 5,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      path: indexPath,
      line: 1,
      column: 10,
    })
  })

  it("returns multiple candidate definitions when the workspace has ambiguous cross-file matches", () => {
    const session = new SemanticWorkerSession()
    const { indexPath, sharedPath } = createWorkspaceFixture("ambiguous-cross-file-definition")
    const duplicatePath = path.join(path.dirname(sharedPath), "Duplicate.ets")

    fs.writeFileSync(
      duplicatePath,
      "export function sharedSubmit() {\n  return 2;\n}\n",
    )

    const response = session.handle({
      id: "definition-4",
      method: "gotoDefinition",
      position: {
        path: indexPath,
        line: 4,
        column: 5,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      definition: {
        path: sharedPath,
        line: 1,
        column: 17,
      },
      definitionCandidates: [
        {
          path: sharedPath,
          line: 1,
          column: 17,
        },
        {
          path: duplicatePath,
          line: 1,
          column: 17,
        },
      ],
    })
  })

  it("resolves imported HarmonyOS SDK symbols into the SDK declaration file", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-sdk-definition-"))
    tempRoots.push(root)

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })

    const sdkRoot = path.join(root, "sdk", "openharmony")
    const sdkApiDir = path.join(sdkRoot, "js", "api")
    fs.mkdirSync(sdkApiDir, { recursive: true })
    fs.mkdirSync(path.join(sdkRoot, "ets"), { recursive: true })
    fs.mkdirSync(path.join(sdkRoot, "toolchains"), { recursive: true })

    const sdkFilePath = path.join(sdkApiDir, "@ohos.app.ability.common.d.ts")
    fs.writeFileSync(
      sdkFilePath,
      "declare namespace common {\nexport type UIAbilityContext = number;\n}\nexport default common;\n",
    )
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      "import common from '@ohos.app.ability.common';\n\nfunction useContext(value: common.UIAbilityContext) {\n  return value;\n}\n",
    )

    const response = session.handle({
      id: "definition-sdk-1",
      method: "gotoDefinition",
      position: {
        path: indexPath,
        line: 3,
        column: 35,
      },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      path: sdkFilePath,
      line: 2,
      column: 13,
    })
  })
})
