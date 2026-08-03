import { describe, expect, it } from "vitest"

import { WorkspaceCompletionCache } from "../features/workspace-completion-cache.js"

describe("workspace completion cache", () => {
  it("reuses document symbol completions until document content changes", () => {
    const cache = new WorkspaceCompletionCache()
    const workspace = view("export function submit() {}")

    expect(cache.collect(workspace).map((item) => item.label)).toEqual(["submit()"])
    expect(cache.collect(workspace).map((item) => item.label)).toEqual(["submit()"])
    expect(cache.snapshot()).toEqual({ documents: 1, hits: 1, misses: 1 })

    expect(cache.collect(view("export function cancel() {}")).map((item) => item.label)).toEqual(["cancel()"])
    expect(cache.snapshot()).toEqual({ documents: 1, hits: 1, misses: 2 })
  })
})

function view(content: string) {
  return {
    rootPath: "/workspace",
    documents: [{ path: "/workspace/Index.ets", content }],
    state: {
      path: "/workspace/Index.ets",
      contentGeneration: 1,
      dependencyGeneration: 1,
      documentCacheHit: false,
      dependencyClosureCacheHit: false,
      queryCacheHit: false,
      loadedDocumentCount: 1,
      syntaxReady: true,
    },
  }
}
