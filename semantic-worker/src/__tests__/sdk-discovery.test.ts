import { describe, expect, it } from "vitest"

import { defaultHarmonySdkCandidates } from "../sdk/discovery.js"

describe("semantic worker sdk discovery", () => {
  it("includes the DevEco default sdk candidate on macOS", () => {
    const candidates = defaultHarmonySdkCandidates("darwin")

    expect(
      candidates.some((candidate) =>
        candidate.includes("DevEco-Studio.app/Contents/sdk/default/openharmony"),
      ),
    ).toBe(true)
  })
})
