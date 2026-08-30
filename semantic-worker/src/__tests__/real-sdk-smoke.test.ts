import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { discoverHarmonySdk } from "../sdk/discovery.js"
import { SemanticWorkerSession } from "../session.js"

const tempRoots: string[] = []
const previousSdkPath = process.env.ARKLINE_HARMONY_SDK_PATH
const REAL_SDK_SMOKE_TIMEOUT_MS = 30_000

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
  if (previousSdkPath === undefined) delete process.env.ARKLINE_HARMONY_SDK_PATH
  else process.env.ARKLINE_HARMONY_SDK_PATH = previousSdkPath
})

describe("real HarmonyOS SDK smoke", () => {
  it("resolves a system type and completes its members from an installed SDK", () => {
    const discovery = discoverHarmonySdk()
    if (!discovery.ready || !discovery.path) {
      if (process.env.ARKLINE_REAL_SDK_REQUIRED === "1") {
        throw new Error("ARKLINE_REAL_SDK_REQUIRED=1 but no HarmonyOS SDK was discovered")
      }
      return
    }
    process.env.ARKLINE_HARMONY_SDK_PATH = discovery.path
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-real-sdk-smoke-"))
    tempRoots.push(root)
    const source = [
      "import common from '@ohos.app.ability.common'",
      "function inspect(context: common.UIAbilityContext): void {",
      "  context.",
      "}",
      "",
    ].join("\n")
    const sourcePath = path.join(root, "Index.ets")
    fs.writeFileSync(sourcePath, source)
    const session = new SemanticWorkerSession()
    const definitionColumn = source.split("\n")[1]!.indexOf("UIAbilityContext") + 2

    const definition = session.handle({
      id: "real-sdk-definition",
      method: "gotoDefinition",
      position: { path: sourcePath, line: 2, column: definitionColumn, workspaceRoot: root },
    })
    const completion = session.handle({
      id: "real-sdk-completion",
      method: "completion",
      position: { path: sourcePath, line: 3, column: 11, workspaceRoot: root },
    })
    const labels = Array.isArray(completion.payload)
      ? completion.payload.flatMap((item) => "label" in item ? [item.label] : [])
      : []

    expect(definition.payload).toEqual(expect.objectContaining({
      definition: expect.objectContaining({
        path: expect.stringContaining("@ohos.app.ability.common.d.ts"),
      }),
    }))
    expect(labels).toEqual(expect.arrayContaining(["filesDir", "terminateSelf"]))
    console.log(`ARKLINE_REAL_SDK_EVIDENCE ${JSON.stringify({
      sdkPath: discovery.path,
      definition: definition.payload,
      requiredCompletionLabels: ["filesDir", "terminateSelf"],
    })}`)
  }, REAL_SDK_SMOKE_TIMEOUT_MS)
})
