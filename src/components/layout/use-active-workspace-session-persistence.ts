import { useEffect, useRef, type RefObject } from "react";
import type { AppSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type SettingsStoreLike = {
  state: { settings: AppSettings };
  update: (update: Partial<AppSettings>) => void;
};

export type UseActiveWorkspaceSessionPersistenceOptions = {
  activePath: string | null;
  rootPath: string | null | undefined;
  settingsHydrated: boolean;
  settingsRef: RefObject<SettingsStoreLike>;
  workspaceApi: WorkspaceApi;
};

export const ACTIVE_SESSION_SAVE_DELAY_MS = 750;

export function useActiveWorkspaceSessionPersistence({
  activePath,
  rootPath,
  settingsHydrated,
  settingsRef,
  workspaceApi,
}: UseActiveWorkspaceSessionPersistenceOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef(false);

  useEffect(() => () => {
    if (!pendingSaveRef.current) return;
    pendingSaveRef.current = false;
    void workspaceApi.saveSettings(settingsRef.current.state.settings);
  }, [settingsRef, workspaceApi]);

  useEffect(() => {
    if (!settingsHydrated || !rootPath || !activePath) return;
    const current = settingsRef.current.state.settings;
    const currentSession = current.workspaceSessions[rootPath] ?? {};
    if (currentSession.activeFilePath === activePath) return;
    const nextWorkspaceSessions = {
      ...current.workspaceSessions,
      [rootPath]: { ...currentSession, activeFilePath: activePath },
    };
    settingsRef.current.update({ workspaceSessions: nextWorkspaceSessions });
    pendingSaveRef.current = true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      pendingSaveRef.current = false;
      void workspaceApi.saveSettings(settingsRef.current.state.settings);
    }, ACTIVE_SESSION_SAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activePath, rootPath, settingsHydrated, settingsRef, workspaceApi]);
}
