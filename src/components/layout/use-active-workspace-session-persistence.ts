import { useEffect, type RefObject } from "react";
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

export function useActiveWorkspaceSessionPersistence({
  activePath,
  rootPath,
  settingsHydrated,
  settingsRef,
  workspaceApi,
}: UseActiveWorkspaceSessionPersistenceOptions) {
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
    void workspaceApi.saveSettings(settingsRef.current.state.settings);
  }, [activePath, rootPath, settingsHydrated, settingsRef, workspaceApi]);
}
