import { normalizePath } from "@/features/workspace/workspace-store";

type CachedDocument = {
  content: string;
  expiresAt: number;
  size: number;
};

export type DocumentLoadCoordinator = ReturnType<typeof createDocumentLoadCoordinator>;

export type DocumentLoadCoordinatorOptions = {
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  maxCacheBytes?: number;
  now?: () => number;
};

export function createDocumentLoadCoordinator(options: DocumentLoadCoordinatorOptions = {}) {
  const pendingLoads = new Map<string, Promise<string>>();
  const cache = new Map<string, CachedDocument>();
  const cacheTtlMs = options.cacheTtlMs ?? 3_000;
  const maxCacheEntries = options.maxCacheEntries ?? 16;
  const maxCacheBytes = options.maxCacheBytes ?? 8 * 1024 * 1024;
  const now = options.now ?? Date.now;
  let cacheBytes = 0;

  function readCached(path: string) {
    const cached = cache.get(path);
    if (!cached) return undefined;
    if (cached.expiresAt <= now()) {
      removeCached(path, cached);
      return undefined;
    }
    cache.delete(path);
    cache.set(path, cached);
    return cached.content;
  }

  function removeCached(path: string, cached = cache.get(path)) {
    if (!cached) return;
    cache.delete(path);
    cacheBytes -= cached.size;
  }

  function cacheContent(path: string, content: string) {
    const size = content.length * 2;
    removeCached(path);
    if (size > maxCacheBytes) return;
    cache.set(path, { content, expiresAt: now() + cacheTtlMs, size });
    cacheBytes += size;
    while (cache.size > maxCacheEntries || cacheBytes > maxCacheBytes) {
      const oldestPath = cache.keys().next().value;
      if (oldestPath === undefined) break;
      removeCached(oldestPath);
    }
  }

  return {
    load(path: string, readFile: (path: string) => Promise<string>) {
      const normalizedPath = normalizePath(path);
      const cached = readCached(normalizedPath);
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = pendingLoads.get(normalizedPath);
      if (pending) return pending;

      const load = readFile(path)
        .then((content) => {
          cacheContent(normalizedPath, content);
          return content;
        })
        .finally(() => {
          pendingLoads.delete(normalizedPath);
        });
      pendingLoads.set(normalizedPath, load);
      return load;
    },
    peek(path: string) {
      return readCached(normalizePath(path));
    },
    invalidate(path: string) {
      removeCached(normalizePath(path));
    },
    clear() {
      cache.clear();
      cacheBytes = 0;
    },
    pendingCount() {
      return pendingLoads.size;
    },
    cacheSize() {
      return cache.size;
    },
  };
}
