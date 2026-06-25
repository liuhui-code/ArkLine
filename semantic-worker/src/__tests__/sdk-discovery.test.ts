import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { defaultHarmonySdkCandidates, discoverHarmonySdk } from "../sdk/discovery.js"

const tempRoots: string[] = []

function createNestedSdkFixture(name: string): { sdkParent: string; sdkDefault: string; openharmony: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `arkline-sdk-discovery-${name}-`))
  tempRoots.push(root)

  const sdkParent = path.join(root, "sdk")
  const sdkDefault = path.join(sdkParent, "default")
  const openharmony = path.join(sdkDefault, "openharmony")
  fs.mkdirSync(path.join(openharmony, "ets"), { recursive: true })
  fs.mkdirSync(path.join(openharmony, "toolchains"), { recursive: true })

  return { sdkParent, sdkDefault, openharmony }
}

afterEach(() => {
  for (const root of tempRoots.splice(0, tempRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("semantic worker sdk discovery", () => {
  it("includes the DevEco default sdk candidate on macOS", () => {
    const candidates = defaultHarmonySdkCandidates("darwin")

    expect(
      candidates.some((candidate) =>
        candidate.includes("DevEco-Studio.app/Contents/sdk/default/openharmony"),
      ),
    ).toBe(true)
  })

  it("accepts the DevEco sdk parent directory and resolves the OpenHarmony root", () => {
    const { sdkParent, openharmony } = createNestedSdkFixture("parent")

    expect(discoverHarmonySdk(sdkParent)).toEqual({
      ready: true,
      path: openharmony,
    })
  })

  it("accepts the DevEco default directory and resolves the OpenHarmony root", () => {
    const { sdkDefault, openharmony } = createNestedSdkFixture("default")

    expect(discoverHarmonySdk(sdkDefault)).toEqual({
      ready: true,
      path: openharmony,
    })
  })
})
