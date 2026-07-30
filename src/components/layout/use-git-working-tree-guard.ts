import { useCallback, useEffect, useRef, useState } from "react";
import { normalizePath } from "@/features/workspace/workspace-store";

export type GitWorkingTreeGuardRequest = {
  actionLabel: string;
  paths: string[] | null;
};

type PendingGuard = GitWorkingTreeGuardRequest & {
  dirtyPaths: string[];
};

type UseGitWorkingTreeGuardOptions = {
  rootPath: string | null;
  getDirtyDocumentPaths: () => string[];
  saveDirtyDocuments: (paths: string[]) => Promise<void>;
};

export function useGitWorkingTreeGuard({
  rootPath,
  getDirtyDocumentPaths,
  saveDirtyDocuments,
}: UseGitWorkingTreeGuardOptions) {
  const [pending, setPending] = useState<PendingGuard | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((ready: boolean) => void) | null>(null);

  const settle = useCallback((ready: boolean) => {
    resolverRef.current?.(ready);
    resolverRef.current = null;
    setPending(null);
    setSaving(false);
    setError(null);
  }, []);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  useEffect(() => {
    if (resolverRef.current) settle(false);
  }, [rootPath, settle]);

  const ensureReady = useCallback((request: GitWorkingTreeGuardRequest) => {
    if (!rootPath || resolverRef.current) return Promise.resolve(false);
    const dirtyPaths = selectAffectedDirtyPaths(rootPath, getDirtyDocumentPaths(), request.paths);
    if (dirtyPaths.length === 0) return Promise.resolve(true);
    setPending({ ...request, dirtyPaths });
    setError(null);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, [getDirtyDocumentPaths, rootPath]);

  const saveAndContinue = useCallback(async () => {
    if (!pending || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveDirtyDocuments(pending.dirtyPaths);
      settle(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  }, [pending, saveDirtyDocuments, saving, settle]);

  return {
    pending,
    saving,
    error,
    ensureReady,
    cancel: () => !saving && settle(false),
    saveAndContinue,
  };
}

export function selectAffectedDirtyPaths(rootPath: string, dirtyPaths: string[], paths: string[] | null) {
  const root = comparablePath(rootPath);
  const workspaceDirtyPaths = dirtyPaths.filter((path) => isWithinRoot(comparablePath(path), root));
  if (paths === null) return workspaceDirtyPaths;
  const targets = new Set(paths.map((path) => comparablePath(resolveFromRoot(rootPath, path))));
  return workspaceDirtyPaths.filter((path) => targets.has(comparablePath(path)));
}

function resolveFromRoot(rootPath: string, path: string) {
  if (isAbsolutePath(path)) return normalizePath(path);
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return normalizePath(`${rootPath}${separator}${path}`);
}

function comparablePath(path: string) {
  const normalized = normalizePath(path).replace(/\\/g, "/").replace(/\/$/, "");
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isWithinRoot(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}

function isAbsolutePath(path: string) {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export type GitWorkingTreeGuardController = ReturnType<typeof useGitWorkingTreeGuard>;
