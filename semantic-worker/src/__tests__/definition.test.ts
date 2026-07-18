import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"
import { createArkuiSdkFixture } from "./semantic-sdk-fixture.js"

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
    expect(response.payload).toEqual({
      status: "ready",
      protocolVersion: 3,
      capabilities: ["completion", "definition", "typeReadiness", "generations", "documentReplay"],
    })
    expect(response.runtime?.rssBytes).toBeGreaterThan(0)
    expect(response.runtime?.uptimeMs).toBeGreaterThanOrEqual(0)
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

  it("limits semantic fallback definitions to the imported dependency closure", () => {
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
      path: sharedPath,
      line: 1,
      column: 17,
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

  it("resolves ArkUI universal attributes from SDK component declarations", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-width-"))
    tempRoots.push(root)
    const { sdkRoot, commonPath } = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })
    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      [
        "@Entry",
        "@Component",
        "struct Index {",
        "  build() {",
        "    Column() {",
        "      Text(\"Hi\")",
        "    }",
        "    .width(100)",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "definition-arkui-width",
      method: "gotoDefinition",
      position: { path: indexPath, line: 8, column: 8 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      path: commonPath,
      line: 3,
      column: 5,
    })
  })

  it("resolves ArkUI attributes when the configured SDK path is the DevEco sdk parent", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-parent-sdk-"))
    tempRoots.push(root)
    const { sdkRoot, commonPath } = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = path.dirname(sdkRoot)

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })
    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      [
        "@Entry",
        "@Component",
        "struct Index {",
        "  build() {",
        "    Text(\"Hi\").width(100)",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "definition-arkui-parent-sdk-width",
      method: "gotoDefinition",
      position: { path: indexPath, line: 5, column: 16 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      path: commonPath,
      line: 3,
      column: 5,
    })
  })

  it("resolves ArkUI attributes from unsaved document content in the request", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-unsaved-width-"))
    tempRoots.push(root)
    const { sdkRoot, commonPath } = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })
    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      [
        "@Entry",
        "@Component",
        "struct Index {",
        "  build() {",
        "    Text(\"Hi\")",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const unsavedContent = [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Text(\"Hi\").width(100)",
      "  }",
      "}",
      "",
    ].join("\n")
    const response = session.handle({
      id: "definition-arkui-unsaved-width",
      method: "gotoDefinition",
      position: { path: indexPath, line: 5, column: 16, content: unsavedContent },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      path: commonPath,
      line: 3,
      column: 5,
    })
  })

  it("resolves width in a multi-line ArkUI chain", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-chain-definition-"))
    tempRoots.push(root)
    const { sdkRoot, commonPath } = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })
    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      [
        "@Entry",
        "@Component",
        "struct Index {",
        "  build() {",
        "    Text(\"Hi\")",
        "      .fontSize(16)",
        "      .width(100)",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "definition-arkui-chain-width",
      method: "gotoDefinition",
      position: { path: indexPath, line: 7, column: 9 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({ path: commonPath, line: 3, column: 5 })
  })

  it("keeps current document definitions ahead of ArkUI system attributes", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-local-width-"))
    tempRoots.push(root)
    const { sdkRoot } = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })
    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      [
        "function width() {",
        "  return 1",
        "}",
        "",
        "function run() {",
        "  width()",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "definition-local-width",
      method: "gotoDefinition",
      position: { path: indexPath, line: 6, column: 4 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual({
      path: indexPath,
      line: 1,
      column: 10,
    })
  })

  it("does not resolve ordinary width calls to ArkUI system attributes", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-ordinary-width-"))
    tempRoots.push(root)
    const { sdkRoot } = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })
    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      [
        "function run() {",
        "  width()",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "definition-ordinary-width",
      method: "gotoDefinition",
      position: { path: indexPath, line: 2, column: 4 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toBeNull()
  })

  it("does not resolve component-specific attributes on the wrong ArkUI receiver", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-wrong-receiver-"))
    tempRoots.push(root)
    const { sdkRoot } = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
    fs.mkdirSync(pagesDir, { recursive: true })
    const indexPath = path.join(pagesDir, "Index.ets")
    fs.writeFileSync(
      indexPath,
      [
        "@Entry",
        "@Component",
        "struct Index {",
        "  build() {",
        "    Text(\"Hi\").justifyContent(FlexAlign.Center)",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "definition-wrong-receiver-justify",
      method: "gotoDefinition",
      position: { path: indexPath, line: 5, column: 16 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toBeNull()
  })
})
