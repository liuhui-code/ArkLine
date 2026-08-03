import { describe, expect, it } from "vitest"

import { SemanticLatencyRegistry } from "../performance/latency-registry.js"

describe("semantic latency registry", () => {
  it("keeps bounded provider histograms with stable percentiles", () => {
    const registry = new SemanticLatencyRegistry()
    for (let index = 1; index <= 140; index += 1) registry.record("completion", index / 1000)

    expect(registry.snapshot().completion).toEqual({
      count: 128,
      p50Us: 76,
      p95Us: 134,
      maxUs: 140,
    })
  })
})
