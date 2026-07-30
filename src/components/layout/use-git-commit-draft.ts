import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_GIT_COMMIT_DRAFT,
  gitCommitDraftStorageKey,
  parseGitCommitDraft,
  type GitCommitDraft,
} from "@/features/git/git-commit-model";
import { createGitQueryId, GIT_QUERY_TIMEOUT_MS } from "@/features/git/git-query-control";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type DraftSession = {
  rootPath: string | null;
  draft: GitCommitDraft;
};

export function useGitCommitDraft(rootPath: string | null, workspaceApi: WorkspaceApi) {
  const [session, setSession] = useState<DraftSession>(() => ({ rootPath, draft: readDraft(rootPath) }));
  const [loadingAmendMessage, setLoadingAmendMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;

  useEffect(() => {
    setSession({ rootPath, draft: readDraft(rootPath) });
    setLoadingAmendMessage(false);
    setError(null);
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath || session.rootPath !== rootPath) return;
    const storage = getStorage();
    if (!storage) return;
    const key = gitCommitDraftStorageKey(rootPath);
    if (isEmptyDraft(session.draft)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(session.draft));
  }, [rootPath, session]);

  const updateDraft = useCallback((update: (draft: GitCommitDraft) => GitCommitDraft) => {
    setSession((current) => current.rootPath === rootPath
      ? { ...current, draft: update(current.draft) }
      : current);
  }, [rootPath]);

  const setMessage = useCallback((message: string) => {
    updateDraft((draft) => ({ ...draft, message }));
  }, [updateDraft]);

  const setSignOff = useCallback((signOff: boolean) => {
    updateDraft((draft) => ({ ...draft, signOff }));
  }, [updateDraft]);

  const setAmend = useCallback(async (amend: boolean) => {
    updateDraft((draft) => ({ ...draft, amend }));
    setError(null);
    if (!amend || !rootPath || session.draft.message.trim() || !workspaceApi.getGitHistory || !workspaceApi.getGitCommitDetails) return;
    setLoadingAmendMessage(true);
    try {
      const history = await workspaceApi.getGitHistory({
        rootPath,
        cursor: null,
        limit: 1,
        requestId: createGitQueryId("git-amend-head"),
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
      });
      const head = history.commits[0];
      if (!head) throw new Error("The repository has no commit to amend");
      const details = await workspaceApi.getGitCommitDetails({
        rootPath,
        commit: head.commit,
        requestId: createGitQueryId("git-amend-message"),
        timeoutMs: GIT_QUERY_TIMEOUT_MS,
        maxDiffBytes: 1,
      });
      if (rootPathRef.current !== rootPath) return;
      const message = details.body.trim() ? `${details.subject}\n\n${details.body.trim()}` : details.subject;
      updateDraft((draft) => draft.amend && !draft.message.trim() ? { ...draft, message } : draft);
    } catch (reason) {
      if (rootPathRef.current === rootPath) {
        setError(reason instanceof Error ? reason.message : String(reason));
        updateDraft((draft) => ({ ...draft, amend: false }));
      }
    } finally {
      if (rootPathRef.current === rootPath) setLoadingAmendMessage(false);
    }
  }, [rootPath, session.draft.message, updateDraft, workspaceApi]);

  const clear = useCallback(() => {
    updateDraft(() => ({ ...EMPTY_GIT_COMMIT_DRAFT }));
  }, [updateDraft]);

  const draft = session.rootPath === rootPath ? session.draft : EMPTY_GIT_COMMIT_DRAFT;
  return { draft, setMessage, setAmend, setSignOff, clear, loadingAmendMessage, error };
}

function readDraft(rootPath: string | null) {
  const storage = getStorage();
  if (!rootPath || !storage) return { ...EMPTY_GIT_COMMIT_DRAFT };
  return parseGitCommitDraft(storage.getItem(gitCommitDraftStorageKey(rootPath)));
}

function isEmptyDraft(draft: GitCommitDraft) {
  return !draft.message && !draft.amend && !draft.signOff;
}

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
