import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { SemanticWorkerSession } from "../session.js"

const tempRoots: string[] = []
const previousSdkPath = process.env.ARKLINE_HARMONY_SDK_PATH

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

function createArkuiSdkFixture(root: string): string {
  const sdkRoot = path.join(root, "sdk", "openharmony")
  const componentDir = path.join(sdkRoot, "ets", "component")
  const componentsDir = path.join(sdkRoot, "ets", "build-tools", "ets-loader", "components")
  fs.mkdirSync(componentDir, { recursive: true })
  fs.mkdirSync(componentsDir, { recursive: true })
  fs.mkdirSync(path.join(sdkRoot, "ets"), { recursive: true })
  fs.mkdirSync(path.join(sdkRoot, "toolchains"), { recursive: true })

  fs.writeFileSync(
    path.join(componentDir, "common.d.ts"),
    [
      "declare class CommonMethod<T> {",
      "    /** Sets the width of the component. */",
      "    width(value: Length): T;",
      "    /** Sets the height of the component. */",
      "    height(value: Length): T;",
      "}",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(componentDir, "column.d.ts"),
    [
      "declare class ColumnAttribute<T> {",
      "    /** Sets the main-axis alignment. */",
      "    justifyContent(value: FlexAlign): T;",
      "}",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(componentsDir, "common_attrs.json"),
    JSON.stringify({ attrs: ["width", "height"] }),
  )
  fs.writeFileSync(
    path.join(componentsDir, "column.json"),
    JSON.stringify({ name: "Column", attrs: ["justifyContent"] }),
  )

  return sdkRoot
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
      { label: "@Entry", detail: "ArkTS decorator", kind: "keyword", source: "arkts" },
      { label: "@Component", detail: "ArkTS decorator", kind: "keyword", source: "arkts" },
      { label: "build()", detail: "Component lifecycle method", kind: "method", source: "arkts" },
      { label: "sharedSubmit()", detail: "Semantic workspace function", kind: "function", source: "workspace" },
    ])
  })

  it("includes ArkUI common and component attributes after a component chain", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-completion-"))
    tempRoots.push(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = createArkuiSdkFixture(root)

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
        "    }.",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "completion-arkui-column",
      method: "completion",
      position: { path: indexPath, line: 6, column: 7 },
    })

    expect(response.ok).toBe(true)
    expect(response.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "width", detail: "width(value: Length): T", kind: "method" }),
      expect.objectContaining({ label: "justifyContent", detail: "justifyContent(value: FlexAlign): T", kind: "method" }),
    ]))
  })

  it("returns rich ArkUI width completion metadata", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-width-v2-"))
    tempRoots.push(root)
    const sdkRoot = createArkuiSdkFixture(root)
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
        "    .wi",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "completion-arkui-width-v2",
      method: "completion",
      position: { path: indexPath, line: 8, column: 8 },
    })

    expect(response.ok).toBe(true)
    const items = response.payload as unknown as Array<Record<string, unknown>>
    expect(items).toContainEqual(expect.objectContaining({
      label: "width",
      detail: "width(value: Length): T",
      kind: "method",
      insertText: "width(${1:value})",
      filterText: "width",
      source: "arkui",
      documentation: "Sets the width of the component.",
      replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
      commitCharacters: ["("],
      definitionTarget: expect.objectContaining({ path: expect.stringContaining("common.d.ts"), line: 3, column: 5 }),
      data: { provider: "arkui-sdk", component: null },
    }))
  })

  it("prefers component-specific ArkUI completion metadata when names overlap", () => {
    const session = new SemanticWorkerSession()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-component-width-"))
    tempRoots.push(root)
    const sdkRoot = createArkuiSdkFixture(root)
    process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

    fs.writeFileSync(
      path.join(sdkRoot, "ets", "component", "column.d.ts"),
      [
        "declare class ColumnAttribute<T> {",
        "    /** Sets the column width. */",
        "    width(value: ColumnLength): T;",
        "}",
        "",
      ].join("\n"),
    )
    fs.writeFileSync(
      path.join(sdkRoot, "ets", "build-tools", "ets-loader", "components", "column.json"),
      JSON.stringify({ name: "Column", attrs: ["width"] }),
    )

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
        "    }.",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const response = session.handle({
      id: "completion-arkui-component-width",
      method: "completion",
      position: { path: indexPath, line: 6, column: 7 },
    })

    expect(response.ok).toBe(true)
    const items = response.payload as unknown as Array<Record<string, unknown>>
    expect(items).toContainEqual(expect.objectContaining({
      label: "width",
      detail: "width(value: ColumnLength): T",
      documentation: "Sets the column width.",
      definitionTarget: expect.objectContaining({ path: expect.stringContaining("column.d.ts"), line: 3, column: 5 }),
      data: { provider: "arkui-sdk", component: "Column" },
    }))
  })
})
