import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { useHydratedSettings } from "@/components/layout/use-hydrated-settings";
import { createSettingsStore, type AppSettings } from "@/features/settings/settings-store";
import type { EnvironmentReport, WorkspaceApi } from "@/features/workspace/workspace-api";

type SettingsStore = ReturnType<typeof createSettingsStore>;

export type UseSettingsControllerOptions = {
  workspaceApi: WorkspaceApi;
  settingsRef: MutableRefObject<SettingsStore>;
  refreshSemanticState: (options?: { throwOnError?: boolean }) => Promise<void>;
  indexSdkSymbolsForSettings: (settings: AppSettings) => Promise<void>;
  onSettingsApplied: (settings: AppSettings) => void;
  onBeforeApply: () => void;
  onStatusChange: (message: string) => void;
};

export function useSettingsController({
  workspaceApi,
  settingsRef,
  refreshSemanticState,
  indexSdkSymbolsForSettings,
  onSettingsApplied,
  onBeforeApply,
  onStatusChange,
}: UseSettingsControllerOptions) {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsSaveState, setSettingsSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [settingsApplyState, setSettingsApplyState] = useState<"idle" | "applying" | "applied" | "failed">("idle");
  const [environmentReport, setEnvironmentReport] = useState<EnvironmentReport | null>(null);
  const [editorAppearance, setEditorAppearance] = useState(createSettingsStore().state.settings.editor);
  const settingsSaveResetTimerRef = useRef<number | null>(null);

  function clearSettingsSaveResetTimer() {
    if (settingsSaveResetTimerRef.current != null) {
      window.clearTimeout(settingsSaveResetTimerRef.current);
      settingsSaveResetTimerRef.current = null;
    }
  }

  async function refreshEnvironmentReport() {
    setEnvironmentReport(await workspaceApi.inspectEnvironment());
  }

  async function openSettings() {
    setSettingsVisible(true);
    await refreshEnvironmentReport();
    onStatusChange("Settings");
  }

  function closeSettings() {
    setSettingsVisible(false);
  }

  async function pickSettingsPath(field: "harmonySdkPath" | "semanticWorkerPath" | "nodePath"): Promise<string | null> {
    const title =
      field === "harmonySdkPath" ? "Select HarmonyOS / ArkTS SDK Path"
      : field === "semanticWorkerPath" ? "Select ArkTS LSP / Semantic Worker Path"
      : "Select Node Directory";
    const selectedPath = await workspaceApi.pickPath?.({
      directory: field !== "semanticWorkerPath",
      title,
    });
    return selectedPath ?? null;
  }

  async function applySettings(nextSettings: AppSettings) {
    setSettingsApplyState("applying");
    setSettingsSaveState("saving");
    onStatusChange("SDK settings applying...");
    clearSettingsSaveResetTimer();
    onBeforeApply();
    try {
      await workspaceApi.saveSettings(nextSettings);
    } catch (error) {
      setSettingsApplyState("failed");
      setSettingsSaveState("idle");
      onStatusChange(`SDK settings apply failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    settingsRef.current.replace(nextSettings);
    setEditorAppearance({ ...nextSettings.editor });
    onSettingsApplied(nextSettings);

    try {
      await refreshEnvironmentReport();
      await refreshSemanticState({ throwOnError: true });
      await indexSdkSymbolsForSettings(nextSettings);
    } catch (error) {
      setSettingsApplyState("failed");
      setSettingsSaveState("idle");
      onStatusChange(`SDK settings apply failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    setSettingsApplyState("applied");
    setSettingsSaveState("saved");
    onStatusChange("SDK settings applied");
    settingsSaveResetTimerRef.current = window.setTimeout(() => {
      setSettingsSaveState("idle");
      settingsSaveResetTimerRef.current = null;
    }, 1200);
  }

  const handleHydratedSettings = useCallback((settings: AppSettings) => {
    setEditorAppearance({ ...settings.editor });
    onSettingsApplied(settings);
  }, [onSettingsApplied]);

  useHydratedSettings({ workspaceApi, settingsRef, onHydrated: handleHydratedSettings });

  return {
    settingsVisible,
    settingsSaveState,
    settingsApplyState,
    settingsApplying: settingsApplyState === "applying",
    environmentReport,
    editorAppearance,
    clearSettingsSaveResetTimer,
    refreshEnvironmentReport,
    openSettings,
    closeSettings,
    pickSettingsPath,
    applySettings,
  };
}
