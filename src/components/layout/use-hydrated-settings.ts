import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { AppSettings } from "@/features/settings/settings-store";
import type { createSettingsStore } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type SettingsStore = ReturnType<typeof createSettingsStore>;

type UseHydratedSettingsArgs = {
  workspaceApi: WorkspaceApi;
  settingsRef: MutableRefObject<SettingsStore>;
  onHydrated: (settings: AppSettings) => void;
};

export function useHydratedSettings({
  workspaceApi,
  settingsRef,
  onHydrated,
}: UseHydratedSettingsArgs) {
  const onHydratedRef = useRef(onHydrated);
  onHydratedRef.current = onHydrated;

  useEffect(() => {
    let cancelled = false;

    async function hydrateSettings() {
      const settings = await workspaceApi.loadSettings();
      if (cancelled) {
        return;
      }

      const current = settingsRef.current.state.settings;
      const unchanged =
        current.editor.fontFamily === settings.editor.fontFamily &&
        current.editor.fontSize === settings.editor.fontSize &&
        current.editor.lineHeight === settings.editor.lineHeight &&
        current.editor.letterSpacing === settings.editor.letterSpacing &&
        current.sdk.harmonySdkPath === settings.sdk.harmonySdkPath &&
        current.sdk.semanticWorkerPath === settings.sdk.semanticWorkerPath &&
        current.sdk.nodePath === settings.sdk.nodePath &&
        current.sdk.autoDetect === settings.sdk.autoDetect &&
        current.validation.formatOnSave === settings.validation.formatOnSave &&
        current.validation.lintCommand === settings.validation.lintCommand &&
        current.validation.formatCommand === settings.validation.formatCommand &&
        current.validation.timeoutMs === settings.validation.timeoutMs &&
        current.recentProjects.join("|") === settings.recentProjects.join("|") &&
        JSON.stringify(current.workspaceSessions) === JSON.stringify(settings.workspaceSessions);

      if (unchanged) {
        onHydratedRef.current(settings);
        return;
      }

      settingsRef.current.replace(settings);
      onHydratedRef.current(settings);
    }

    void hydrateSettings();
    return () => {
      cancelled = true;
    };
  }, [settingsRef, workspaceApi]);
}
