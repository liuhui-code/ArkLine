import type { SemanticResponsePayload, SemanticResponseState } from "../protocol.js"

const MAX_QUERY_CACHE_ENTRIES = 256

interface CachedQuery {
  payload: SemanticResponsePayload
  state: SemanticResponseState
}

export class SemanticQueryCache {
  private readonly entries = new Map<string, CachedQuery>()

  get(key: string): CachedQuery | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  set(key: string, value: CachedQuery): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > MAX_QUERY_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

export function semanticQueryCacheKey(
  method: string,
  state: SemanticResponseState,
  line: number,
  column: number,
): string {
  return [
    method,
    state.path,
    line,
    column,
    state.contentGeneration,
    state.dependencyGeneration,
    state.typeEngineVersion ?? "no-type-engine",
    state.typeGeneration ?? 0,
  ].join(":")
}
