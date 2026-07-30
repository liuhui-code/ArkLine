import { useCallback, type MutableRefObject } from "react";
import type { createDocumentStore } from "@/features/documents/document-store";
import type { createEditorTabsStore } from "@/features/documents/editor-tabs-store";
import type { WorkspaceApi, WorkspaceDirectoryEntry } from "@/features/workspace/workspace-api";
import { normalizePath } from "@/features/workspace/workspace-store";
import { selectAffectedDirtyPaths } from "@/components/layout/use-git-working-tree-guard";

type DocumentStore = ReturnType<typeof createDocumentStore>;
type EditorTabsStore = ReturnType<typeof createEditorTabsStore>;

export type GitDocumentReconciliationReport = {
  updatedPaths: string[];
  deletedPaths: string[];
  conflictPaths: string[];
  failedPaths: string[];
};

export type GitDocumentReconciler = (paths: string[] | null) => Promise<GitDocumentReconciliationReport>;

type UseGitDocumentSafetyOptions = {
  rootPath?: string | null;
  documentsRef: MutableRefObject<DocumentStore>;
  tabsRef?: MutableRefObject<EditorTabsStore>;
  syncTabs: () => void;
  setActiveDocument?: (path: string | null) => void;
  saveFile: (path: string, content: string) => Promise<void>;
  readFile?: (path: string) => Promise<string>;
  listWorkspaceDirectory?: WorkspaceApi["listWorkspaceDirectory"];
  invalidateDocumentCache?: (path: string) => void;
  onDocumentChanged?: (path: string, content: string) => void;
  onDocumentClosed?: (path: string) => void;
};

export function useGitDocumentSafety(options: UseGitDocumentSafetyOptions) {
  const {
    rootPath, documentsRef, tabsRef, syncTabs, setActiveDocument, saveFile, readFile,
    listWorkspaceDirectory, invalidateDocumentCache, onDocumentChanged, onDocumentClosed,
  } = options;
  const getDirtyDocumentPaths = useCallback(() => documentsRef.current.getDocuments()
    .filter((document) => document.isDirty)
    .map((document) => document.path), [documentsRef]);

  const saveDirtyDocuments = useCallback(async (paths: string[]) => {
    try {
      for (const path of paths) {
        const document = documentsRef.current.getDocument(path);
        if (!document?.isDirty) continue;
        await saveFile(path, document.currentContent);
        documentsRef.current.saveDocument(path);
      }
    } finally {
      syncTabs();
    }
  }, [documentsRef, saveFile, syncTabs]);

  const reconcileDocuments = useCallback<GitDocumentReconciler>(async (paths) => {
    const report = emptyReconciliationReport();
    if (!rootPath || !tabsRef || !readFile) return report;
    const openPaths = tabsRef.current.state.openTabs.map((tab) => tab.path);
    const candidates = selectAffectedDirtyPaths(rootPath, openPaths, paths);
    const directoryCache = new Map<string, Promise<WorkspaceDirectoryEntry[] | null>>();
    await runBounded(candidates, 4, async (path) => {
      invalidateDocumentCache?.(path);
      try {
        const content = await readFile(path);
        const result = documentsRef.current.applyExternalChange(path, content);
        if (result === "updated") {
          report.updatedPaths.push(path);
          onDocumentChanged?.(path, content);
        } else {
          report.conflictPaths.push(path);
        }
      } catch {
        const exists = await inspectPathExists(rootPath, path, listWorkspaceDirectory, directoryCache);
        if (exists !== false) {
          report.failedPaths.push(path);
          return;
        }
        const result = documentsRef.current.applyExternalDeletion(path);
        if (result === "conflict") {
          report.conflictPaths.push(path);
          return;
        }
        tabsRef.current.closeTab(path);
        documentsRef.current.releaseDocument(path);
        onDocumentClosed?.(path);
        report.deletedPaths.push(path);
      }
    });
    report.updatedPaths.sort();
    report.deletedPaths.sort();
    report.conflictPaths.sort();
    report.failedPaths.sort();
    syncTabs();
    setActiveDocument?.(tabsRef.current.state.activePath);
    return report;
  }, [documentsRef, invalidateDocumentCache, listWorkspaceDirectory, onDocumentChanged, onDocumentClosed, readFile, rootPath, setActiveDocument, syncTabs, tabsRef]);

  return { getDirtyDocumentPaths, saveDirtyDocuments, reconcileDocuments };
}

export const skipGitDocumentReconciliation: GitDocumentReconciler = async () => emptyReconciliationReport();

export function gitMutationStatus(message: string, report: GitDocumentReconciliationReport) {
  const attention = report.conflictPaths.length + report.failedPaths.length;
  return attention ? `${message}. ${attention} open file${attention === 1 ? " needs" : "s need"} attention` : message;
}

export async function gitMutationError(reason: unknown, reconcile: GitDocumentReconciler, paths: string[] | null) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return gitMutationStatus(message, await reconcile(paths));
}

function emptyReconciliationReport(): GitDocumentReconciliationReport {
  return { updatedPaths: [], deletedPaths: [], conflictPaths: [], failedPaths: [] };
}

async function inspectPathExists(
  rootPath: string,
  path: string,
  listDirectory: WorkspaceApi["listWorkspaceDirectory"],
  cache: Map<string, Promise<WorkspaceDirectoryEntry[] | null>>,
) {
  if (!listDirectory) return null;
  const parent = parentPath(path) || rootPath;
  let entries = cache.get(parent);
  if (!entries) {
    entries = listDirectory(rootPath, parent).catch(() => null);
    cache.set(parent, entries);
  }
  return (await entries)?.some((entry) => normalizePath(entry.path) === normalizePath(path)) ?? null;
}

function parentPath(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}

async function runBounded<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await task(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
