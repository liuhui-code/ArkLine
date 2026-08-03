import type { Text } from "@codemirror/state"
import type { SemanticDocumentSyncRequest, WorkspaceApi } from "@/features/workspace/workspace-api-contract"

type PendingDocument = SemanticDocumentSyncRequest
export type SemanticDocumentSnapshot = string | Text

export type SemanticDocumentSyncQueue = {
  open(path: string, snapshot: SemanticDocumentSnapshot, workspaceRoot?: string): void
  change(path: string, snapshot: SemanticDocumentSnapshot, workspaceRoot?: string): void
  ensure(path: string, snapshot: SemanticDocumentSnapshot, workspaceRoot?: string): Promise<number | null>
  close(path: string): void
  dispose(): void
}

type SemanticSyncApi = {
  syncSemanticDocument?: WorkspaceApi["syncSemanticDocument"]
  prepareSemanticDocument?: WorkspaceApi["prepareSemanticDocument"]
  closeSemanticDocument?: WorkspaceApi["closeSemanticDocument"]
}

type QueueEntry = {
  snapshot: SemanticDocumentSnapshot
  version: number
  workspaceRoot?: string
  timer: ReturnType<typeof setTimeout> | null
  warmTimer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  closed: boolean
  publishedVersion: number
  readyVersion: number
  waiters: Array<{ version: number; resolve: (version: number | null) => void }>
}

const OPEN_DEFER_MS = 32
const CHANGE_DEBOUNCE_MS = 180
const MAX_RETAINED_DOCUMENTS = 12
const PREPARE_IDLE_DELAY_MS = 120

export function createSemanticDocumentSyncQueue(
  api: SemanticSyncApi,
): SemanticDocumentSyncQueue {
  const entries = new Map<string, QueueEntry>()
  let disposed = false

  function retain(path: string, entry: QueueEntry) {
    entries.delete(path)
    entries.set(path, entry)
  }

  function closeEntry(path: string, entry: QueueEntry) {
    entry.closed = true
    settleWaiters(entry, Number.MAX_SAFE_INTEGER, true)
    if (entry.timer !== null) clearTimeout(entry.timer)
    if (entry.warmTimer !== null) clearTimeout(entry.warmTimer)
    entry.timer = null
    entry.warmTimer = null
    entries.delete(path)
    const closeSemanticDocument = api.closeSemanticDocument
    if (closeSemanticDocument) void closeSemanticDocument({ path }).catch(() => undefined)
  }

  function evictOldDocuments() {
    while (entries.size > MAX_RETAINED_DOCUMENTS) {
      const oldest = entries.entries().next().value as [string, QueueEntry] | undefined
      if (!oldest) return
      closeEntry(oldest[0], oldest[1])
    }
  }

  function schedulePrepare(path: string, entry: QueueEntry, version: number) {
    const prepareSemanticDocument = api.prepareSemanticDocument
    if (!prepareSemanticDocument) return
    if (entry.warmTimer !== null) clearTimeout(entry.warmTimer)
    entry.warmTimer = setTimeout(() => {
      entry.warmTimer = null
      if (disposed || entry.closed || entry.readyVersion < version || entry.version !== version) return
      void prepareSemanticDocument({ path, documentVersion: version }).catch(() => undefined)
    }, PREPARE_IDLE_DELAY_MS)
  }

  function publish(path: string, entry: QueueEntry, method: "didOpen" | "didChange") {
    if (disposed || entry.closed || entry.inFlight || entry.version <= entry.publishedVersion) return
    entry.inFlight = true
    entry.publishedVersion = entry.version
    const publishedVersion = entry.version
    const content = materializeSnapshot(entry.snapshot)
    const request: PendingDocument = {
      method,
      path,
      content,
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
        schedulePrepare(path, entry, publishedVersion)
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

  function schedule(path: string, entry: QueueEntry, method: "didOpen" | "didChange", delay: number) {
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      publish(path, entry, method)
    }, delay)
  }

  function open(path: string, snapshot: SemanticDocumentSnapshot, workspaceRoot?: string) {
    if (disposed) return
    const previous = entries.get(path)
    if (previous && !previous.closed && sameSnapshot(previous.snapshot, snapshot)) {
      previous.workspaceRoot = workspaceRoot ?? previous.workspaceRoot
      retain(path, previous)
      return
    }
    const entry: QueueEntry = previous ?? {
      snapshot,
      version: 0,
      workspaceRoot,
      timer: null,
      warmTimer: null,
      inFlight: false,
      closed: false,
      publishedVersion: 0,
      readyVersion: 0,
      waiters: [],
    }
    entry.snapshot = snapshot
    entry.version = Math.max(1, entry.version + 1)
    entry.workspaceRoot = workspaceRoot
    entry.closed = false
    retain(path, entry)
    schedule(path, entry, "didOpen", OPEN_DEFER_MS)
    evictOldDocuments()
  }

  function change(path: string, snapshot: SemanticDocumentSnapshot, workspaceRoot?: string) {
    if (disposed) return
    const entry = entries.get(path)
    if (!entry) {
      open(path, snapshot, workspaceRoot)
      return
    }
    if (sameSnapshot(entry.snapshot, snapshot) && !entry.closed) return
    entry.snapshot = snapshot
    entry.version += 1
    entry.workspaceRoot = workspaceRoot ?? entry.workspaceRoot
    entry.closed = false
    retain(path, entry)
    const method = entry.publishedVersion === 0 ? "didOpen" : "didChange"
    schedule(path, entry, method, CHANGE_DEBOUNCE_MS)
  }

  function ensure(path: string, snapshot: SemanticDocumentSnapshot, workspaceRoot?: string): Promise<number | null> {
    if (disposed || !api.syncSemanticDocument) return Promise.resolve(null)
    let entry = entries.get(path)
    if (!entry) {
      open(path, snapshot, workspaceRoot)
      entry = entries.get(path)
    } else if (!sameSnapshot(entry.snapshot, snapshot) || entry.closed) {
      change(path, snapshot, workspaceRoot)
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
    closeEntry(path, entry)
  }

  function dispose() {
    disposed = true
    for (const entry of entries.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer)
      if (entry.warmTimer !== null) clearTimeout(entry.warmTimer)
    }
    entries.clear()
  }

  return { open, change, ensure, close, dispose }
}

function sameSnapshot(left: SemanticDocumentSnapshot, right: SemanticDocumentSnapshot) {
  return left === right
}

function materializeSnapshot(snapshot: SemanticDocumentSnapshot) {
  return typeof snapshot === "string" ? snapshot : snapshot.toString()
}
