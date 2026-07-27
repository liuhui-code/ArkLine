import { describe, expect, it } from "vitest"

import { isMemberAccessCompletion } from "../features/completion-context.js"

describe("completion context", () => {
  it.each([
    ["service.", 9],
    ["service.pr", 11],
    ["service?.profile", 17],
    ["    .width", 11],
  ])("recognizes member access in %s", (content, column) => {
    expect(isMemberAccessCompletion(content, { path: "/workspace/Index.ets", line: 1, column })).toBe(true)
  })

  it.each([
    ["private", 8],
    ["const value = 1.25", 19],
  ])("keeps global completion context in %s", (content, column) => {
    expect(isMemberAccessCompletion(content, { path: "/workspace/Index.ets", line: 1, column })).toBe(false)
  })
})
