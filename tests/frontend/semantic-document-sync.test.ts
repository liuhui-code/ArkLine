import { afterEach, describe, expect, it, vi } from "vitest"
import { createSemanticDocumentSyncQueue } from "@/features/semantic/semantic-document-sync"

describe("semantic document sync queue", () => {
  afterEach(() => vi.useRealTimers())

  it("publishes open immediately and coalesces rapid changes per file", async () => {
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const closeSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument, closeSemanticDocument })

    queue.open("/workspace/Index.ets", "one")
    await new Promise((resolve) => setTimeout(resolve, 0))
    queue.change("/workspace/Index.ets", "two")
    queue.change("/workspace/Index.ets", "three")
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(syncSemanticDocument).toHaveBeenCalledTimes(2)
    expect(syncSemanticDocument.mock.calls[0]?.[0]).toMatchObject({ method: "didOpen", documentVersion: 1 })
    expect(syncSemanticDocument.mock.calls[1]?.[0]).toMatchObject({ method: "didChange", content: "three", documentVersion: 3 })
    queue.dispose()
  })

  it("closes a document without blocking the editor", () => {
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const closeSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument, closeSemanticDocument })

    queue.open("/workspace/Index.ets", "one")
    queue.close("/workspace/Index.ets")

    expect(closeSemanticDocument).toHaveBeenCalledWith({ path: "/workspace/Index.ets" })
    queue.dispose()
  })

  it("waits for the acknowledged version before a query omits document content", async () => {
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const closeSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument, closeSemanticDocument })

    const version = await queue.ensure("/workspace/Unsaved.ets", "const 名称 = 1\r\n名称")

    expect(version).toBe(1)
    expect(syncSemanticDocument).toHaveBeenCalledWith(expect.objectContaining({
      method: "didOpen",
      documentVersion: 1,
      content: "const 名称 = 1\r\n名称",
    }))
    queue.dispose()
  })
})
