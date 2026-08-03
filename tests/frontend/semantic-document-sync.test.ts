import { Text } from "@codemirror/state"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createSemanticDocumentSyncQueue } from "@/features/semantic/semantic-document-sync"

describe("semantic document sync queue", () => {
  afterEach(() => vi.useRealTimers())

  it("defers open until after activation and coalesces rapid changes per file", async () => {
    vi.useFakeTimers()
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const closeSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument, closeSemanticDocument })

    queue.open("/workspace/Index.ets", "one")
    expect(syncSemanticDocument).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(32)
    queue.change("/workspace/Index.ets", "two")
    queue.change("/workspace/Index.ets", "three")
    await vi.advanceTimersByTimeAsync(180)

    expect(syncSemanticDocument).toHaveBeenCalledTimes(2)
    expect(syncSemanticDocument.mock.calls[0]?.[0]).toMatchObject({ method: "didOpen", documentVersion: 1 })
    expect(syncSemanticDocument.mock.calls[1]?.[0]).toMatchObject({ method: "didChange", content: "three", documentVersion: 3 })
    queue.dispose()
  })

  it("materializes an immutable editor snapshot only when the deferred sync publishes", async () => {
    vi.useFakeTimers()
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument })
    const document = Text.of(["const value = 1;"])
    const toString = vi.spyOn(Text.prototype, "toString")

    queue.open("/workspace/Index.ets", document)
    expect(toString).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(32)

    expect(toString).toHaveBeenCalledTimes(1)
    expect(syncSemanticDocument).toHaveBeenCalledWith(expect.objectContaining({
      content: "const value = 1;",
    }))
    toString.mockRestore()
    queue.dispose()
  })

  it("keeps the first coalesced edit as didOpen when activation has not published yet", async () => {
    vi.useFakeTimers()
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument })

    queue.open("/workspace/Index.ets", "one")
    queue.change("/workspace/Index.ets", "two")
    await vi.advanceTimersByTimeAsync(180)

    expect(syncSemanticDocument).toHaveBeenCalledWith(expect.objectContaining({
      method: "didOpen",
      content: "two",
      documentVersion: 2,
    }))
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

  it("keeps a recently reopened document warm without publishing it again", async () => {
    vi.useFakeTimers()
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument })

    queue.open("/workspace/Index.ets", "one")
    await vi.advanceTimersByTimeAsync(32)
    queue.open("/workspace/Index.ets", "one")
    await vi.advanceTimersByTimeAsync(32)

    expect(syncSemanticDocument).toHaveBeenCalledTimes(1)
    queue.dispose()
  })

  it("evicts the least recently used semantic document at the retention limit", () => {
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const closeSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument, closeSemanticDocument })

    for (let index = 0; index < 13; index += 1) {
      queue.open(`/workspace/File${index}.ets`, `const value = ${index}`)
    }

    expect(closeSemanticDocument).toHaveBeenCalledTimes(1)
    expect(closeSemanticDocument).toHaveBeenCalledWith({ path: "/workspace/File0.ets" })
    queue.dispose()
  })

  it("prepares only the latest acknowledged document version after an idle delay", async () => {
    vi.useFakeTimers()
    const syncSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const prepareSemanticDocument = vi.fn().mockResolvedValue(undefined)
    const queue = createSemanticDocumentSyncQueue({ syncSemanticDocument, prepareSemanticDocument })

    queue.open("/workspace/Index.ets", "one")
    await vi.advanceTimersByTimeAsync(32)
    queue.change("/workspace/Index.ets", "two")
    await vi.advanceTimersByTimeAsync(180)
    expect(prepareSemanticDocument).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(120)
    expect(prepareSemanticDocument).toHaveBeenCalledTimes(1)
    expect(prepareSemanticDocument).toHaveBeenCalledWith({
      path: "/workspace/Index.ets",
      documentVersion: 2,
    })
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
