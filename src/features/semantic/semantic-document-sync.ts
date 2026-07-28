import type { SemanticDocumentSyncRequest, WorkspaceApi } from "@/features/workspace/workspace-api-contract"

type PendingDocument = SemanticDocumentSyncRequest

export type SemanticDocumentSyncQueue = {
  open(path: string, content: string, workspaceRoot?: string): void
  change(path: string, content: string, workspaceRoot?: string): void
  ensure(path: string, content: string, workspaceRoot?: string): Promise<number | null>
  close(path: string): void
  dispose(): void
}

type SemanticSyncApi = {
  syncSemanticDocument?: WorkspaceApi["syncSemanticDocument"]
  closeSemanticDocument?: WorkspaceApi["closeSemanticDocument"]
}

type QueueEntry = {
  content: string
  version: number
  workspaceRoot?: string
  timer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  closed: boolean
  publishedVersion: number
  readyVersion: number
  waiters: Array<{ version: number; resolve: (version: number | null) => void }>
}

const CHANGE_DEBOUNCE_MS = 16

export function createSemanticDocumentSyncQueue(
  api: SemanticSyncApi,
): SemanticDocumentSyncQueue {
  const entries = new Map<string, QueueEntry>()
  let disposed = false

  function publish(path: string, entry: QueueEntry, method: "didOpen" | "didChange") {
    if (disposed || entry.closed || entry.inFlight || entry.version <= entry.publishedVersion) return
    entry.inFlight = true
    entry.publishedVersion = entry.version
    const publishedVersion = entry.version
    const request: PendingDocument = {
      method,
      path,
      content: entry.content,
      documentVersion: entry.version,
      workspaceRoot: entry.workspaceRoot,
    }
    const syncSemanticDocument = api.syncSemanticDocument
    if (!syncSemanticDocument) {
      entry.inFlight = false
      return
    }
    void syncSemanticDocument(request).then(
      () => {
        entry.readyVersion = Math.max(entry.readyVersion, publishedVersion)
        settleWaiters(entry, publishedVersion)
      },
      () => settleWaiters(entry, publishedVersion, true),
    ).finally(() => {
        entry.inFlight = false
        if (disposed || entry.closed) return
        if (entry.timer === null) {
          publish(path, entry, "didChange")
        }
      })
  }

  function settleWaiters(entry: QueueEntry, version: number, failed = false) {
    const remaining = entry.waiters.filter((waiter) => waiter.version > version)
    for (const waiter of entry.waiters) {
      if (waiter.version <= version) waiter.resolve(failed ? null : version)
    }
    entry.waiters = remaining
  }

  function schedule(path: string, entry: QueueEntry, method: "didOpen" | "didChange", immediate = false) {
    if (entry.timer !== null) clearTimeout(entry.timer)
    if (immediate) {
      entry.timer = null
      publish(path, entry, method)
      return
    }
    entry.timer = setTimeout(() => {
      entry.timer = null
      publish(path, entry, method)
    }, CHANGE_DEBOUNCE_MS)
  }

  function open(path: string, content: string, workspaceRoot?: string) {
    if (disposed) return
    const previous = entries.get(path)
    const entry: QueueEntry = previous ?? {
      content: "",
      version: 0,
      workspaceRoot,
      timer: null,
      inFlight: false,
      closed: false,
      publishedVersion: 0,
      readyVersion: 0,
      waiters: [],
    }
    entry.content = content
    entry.version = Math.max(1, entry.version + 1)
    entry.workspaceRoot = workspaceRoot
    entry.closed = false
    entries.set(path, entry)
    schedule(path, entry, "didOpen", true)
  }

  function change(path: string, content: string, workspaceRoot?: string) {
    if (disposed) return
    const entry = entries.get(path)
    if (!entry) {
      open(path, content, workspaceRoot)
      return
    }
    if (entry.content === content && !entry.closed) return
    entry.content = content
    entry.version += 1
    entry.workspaceRoot = workspaceRoot ?? entry.workspaceRoot
    entry.closed = false
    schedule(path, entry, "didChange")
  }

  function ensure(path: string, content: string, workspaceRoot?: string): Promise<number | null> {
    if (disposed || !api.syncSemanticDocument) return Promise.resolve(null)
    let entry = entries.get(path)
    if (!entry) {
      open(path, content, workspaceRoot)
      entry = entries.get(path)
    } else if (entry.content !== content || entry.closed) {
      change(path, content, workspaceRoot)
      entry = entries.get(path)
    }
    if (!entry) return Promise.resolve(null)
    if (entry.readyVersion >= entry.version) return Promise.resolve(entry.version)
    const version = entry.version
    return new Promise((resolve) => entry?.waiters.push({ version, resolve }))
  }

  function close(path: string) {
    const entry = entries.get(path)
    if (!entry) return
    entry.closed = true
    settleWaiters(entry, Number.MAX_SAFE_INTEGER, true)
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = null
    const closeSemanticDocument = api.closeSemanticDocument
    if (closeSemanticDocument) void closeSemanticDocument({ path }).catch(() => undefined)
    entries.delete(path)
  }

  function dispose() {
    disposed = true
    for (const entry of entries.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer)
    }
    entries.clear()
  }

  return { open, change, ensure, close, dispose }
}
