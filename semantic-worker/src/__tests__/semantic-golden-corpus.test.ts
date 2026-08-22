import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { runSemanticGoldenCorpus } from "../golden-corpus/runner.js"

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const corpusPath = path.resolve(testDirectory, "../../fixtures/golden-corpus/v1/corpus.json")

describe("semantic golden corpus", () => {
  it("meets the exact definition and receiver-member baseline", () => {
    const report = runSemanticGoldenCorpus(corpusPath)
    console.log(`ARKLINE_SEMANTIC_QUALITY ${JSON.stringify(report)}`)

    expect(report.failedCases).toEqual([])
    expect(report.definition).toEqual({ exact: 5, total: 5 })
    expect(report.usages).toEqual({
      cases: 1,
      exactMatches: 1,
      totalExpected: 1,
      unexpected: 0,
    })
    expect(report.completion).toEqual({
      cases: 7,
      forbiddenViolations: 0,
      requiredTopK: 15,
      totalRequired: 15,
    })
    expect(report.coverage).toEqual([
      "alias",
      "arkts",
      "arkui",
      "async-return",
      "completion",
      "cross-file",
      "definition",
      "function",
      "generic",
      "import",
      "member",
      "negative-candidates",
      "provider",
      "re-export",
      "same-file",
      "sdk",
      "sdk-member",
      "source-map",
      "symbol-identity",
      "system-api",
      "this-receiver",
      "typed-receiver",
      "typescript",
      "usages",
      "virtual-document",
    ])
  })
})
