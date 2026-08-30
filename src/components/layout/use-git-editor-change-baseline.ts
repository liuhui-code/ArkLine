import { useEffect, useState } from "react";
import type { GitChangeBaseline } from "@/editor/git-change-decorations";
import { createGitQueryId, GIT_DIFF_LIMIT_BYTES, GIT_QUERY_TIMEOUT_MS } from "@/features/git/git-query-control";
import { getRelativeWorkspacePath } from "@/features/search/workspace-text-search";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type Options = {
  rootPath: string | null;
  activePath: string | null;
  repositoryGeneration?: number | null;
  workspaceApi: WorkspaceApi;
};

const MAX_CACHED_BASELINES = 64;
const baselineCaches = new WeakMap<WorkspaceApi, Map<string, GitChangeBaseline>>();

export function useGitEditorChangeBaseline({
  rootPath,
  activePath,
  repositoryGeneration,
  workspaceApi,
}: Options) {
  const [baseline, setBaseline] = useState<GitChangeBaseline | null>(null);

  useEffect(() => {
    let active = true;
    if (!rootPath || !activePath || !workspaceApi.getGitFileComparison) {
      setBaseline(null);
      return () => { active = false; };
    }

    const relativePath = getRelativeWorkspacePath(rootPath, activePath);
    if (isAbsolutePath(relativePath)) {
      setBaseline(null);
      return () => { active = false; };
    }
    const cacheKey = repositoryGeneration == null
      ? null
      : `${rootPath}\0${repositoryGeneration}\0${relativePath}`;
    const cache = baselineCacheFor(workspaceApi);
    const cached = cacheKey ? cache.get(cacheKey) : null;
    if (cached && cacheKey) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      setBaseline(cached);
      return () => { active = false; };
    }

    setBaseline(null);
    const requestId = createGitQueryId("git-editor-head");
    void workspaceApi.getGitFileComparison({
      rootPath,
      relativePath,
      originalPath: null,
      staged: false,
      scope: "commit",
      requestId,
      timeoutMs: GIT_QUERY_TIMEOUT_MS,
      maxBytes: GIT_DIFF_LIMIT_BYTES,
    }).then((comparison) => {
      if (!active || comparison.before.binary || comparison.before.truncated) return;
      const next = {
        revision: `${repositoryGeneration ?? "unknown"}:${requestId}`,
        content: comparison.before.exists ? comparison.before.content ?? "" : "",
      };
      if (cacheKey) cacheBaseline(cache, cacheKey, next);
      setBaseline(next);
    }).catch(() => {
      if (active) setBaseline(null);
    });

    return () => {
      active = false;
      void workspaceApi.cancelGitQuery?.(requestId);
    };
  }, [activePath, repositoryGeneration, rootPath, workspaceApi]);

  return baseline;
}

function baselineCacheFor(workspaceApi: WorkspaceApi) {
  let cache = baselineCaches.get(workspaceApi);
  if (!cache) {
    cache = new Map();
    baselineCaches.set(workspaceApi, cache);
  }
  return cache;
}

function cacheBaseline(
  cache: Map<string, GitChangeBaseline>,
  key: string,
  baseline: GitChangeBaseline,
) {
  cache.set(key, baseline);
  while (cache.size > MAX_CACHED_BASELINES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
}
