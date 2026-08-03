import { describe, expect, it } from "vitest"

import { createArktsVirtualDocument } from "../virtual/arkts-virtual-document.js"

describe("ArkTS virtual document", () => {
  it("maps positions across a non-length-preserving struct rewrite", () => {
    const source = "export struct User { name: string }\n"
    const document = createArktsVirtualDocument("/workspace/User.ets", source)
    const sourceName = source.indexOf("name")
    const generatedName = document.generatedContent.indexOf("name")

    expect(document.generatedContent).toBe("export class User { name: string }\n")
    expect(document.toGeneratedOffset(sourceName)).toBe(generatedName)
    expect(document.toSourceOffset(generatedName)).toBe(sourceName)
  })

  it("maps generated replacement spans back to original coordinates", () => {
    const source = "struct Screen { title: string; render() { this.ti } }\n"
    const document = createArktsVirtualDocument("/workspace/Screen.ets", source)
    const generatedStart = document.generatedContent.indexOf("ti", document.generatedContent.indexOf("this."))

    expect(document.generatedSpanToSourceRange(generatedStart, 2)).toEqual({
      startLine: 1,
      startColumn: source.indexOf("ti", source.indexOf("this.")) + 1,
      endLine: 1,
      endColumn: source.indexOf("ti", source.indexOf("this.")) + 3,
    })
  })

  it("keeps mappings stable across multiple rewrites", () => {
    const source = "struct First {}\nstruct Second { value: number }\n"
    const document = createArktsVirtualDocument("/workspace/Models.ets", source)
    const sourceValue = source.indexOf("value")
    const generatedValue = document.generatedContent.indexOf("value")

    expect(document.generatedContent).toBe("class First {}\nclass Second { value: number }\n")
    expect(document.toGeneratedOffset(sourceValue)).toBe(generatedValue)
    expect(document.toSourceOffset(generatedValue)).toBe(sourceValue)
  })

  it("maps offsets through a large sparse rewrite table", () => {
    const source = Array.from(
      { length: 2_000 },
      (_, index) => `struct Model${index} { value${index}: number }`,
    ).join("\n")
    const document = createArktsVirtualDocument("/workspace/Models.ets", source)
    const sourceOffset = source.lastIndexOf("value1999")
    const generatedOffset = document.generatedContent.lastIndexOf("value1999")

    expect(document.toGeneratedOffset(sourceOffset)).toBe(generatedOffset)
    expect(document.toSourceOffset(generatedOffset)).toBe(sourceOffset)
  })
})
