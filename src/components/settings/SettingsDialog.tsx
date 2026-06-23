import { useEffect, useMemo, useState } from "react";
import type { AppSettings, AppSettingsPatch } from "@/features/settings/settings-store";
import type { EnvironmentReport } from "@/features/workspace/workspace-api";
import { SettingsEditorPanel } from "@/components/settings/settings-sections/SettingsEditorPanel";
import { SettingsSdkPanel } from "@/components/settings/settings-sections/SettingsSdkPanel";
import { SettingsSidebar, type SettingsSectionKey } from "@/components/settings/settings-sections/SettingsSidebar";
import { SettingsValidationPanel } from "@/components/settings/settings-sections/SettingsValidationPanel";

type SettingsDialogProps = {
  environmentReport: EnvironmentReport | null;
  onApply: (settings: AppSettings) => Promise<void>;
  onClose: () => void;
  onPickPath: (field: "harmonySdkPath" | "semanticWorkerPath" | "nodePath") => Promise<string | null>;
  onRefreshEnvironment: () => void;
  open: boolean;
  saveStateLabel: string;
  settings: AppSettings;
};

function mergeDraftSettings(current: AppSettings, update: AppSettingsPatch): AppSettings {
  return {
    editor: { ...current.editor, ...update.editor },
    sdk: { ...current.sdk, ...update.sdk },
    validation: { ...current.validation, ...update.validation },
    recentProjects: update.recentProjects ?? current.recentProjects,
  };
}

function sameSettings(left: AppSettings, right: AppSettings) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function SettingsDialog({
  environmentReport,
  onApply,
  onClose,
  onPickPath,
  onRefreshEnvironment,
  open,
  saveStateLabel,
  settings,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("sdk");
  const [draftSettings, setDraftSettings] = useState(settings);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const isDirty = useMemo(() => !sameSettings(draftSettings, settings), [draftSettings, settings]);

  useEffect(() => {
    if (open) {
      setActiveSection("sdk");
      setDraftSettings(settings);
      setApplyError("");
      setIsApplying(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && !isApplying) {
      setDraftSettings(settings);
    }
  }, [open, settings, isApplying]);

  function updateDraft(update: AppSettingsPatch) {
    setDraftSettings((current) => mergeDraftSettings(current, update));
    setApplyError("");
  }

  async function pickDraftPath(field: "harmonySdkPath" | "semanticWorkerPath" | "nodePath") {
    const selectedPath = await onPickPath(field);
    if (!selectedPath) {
      return;
    }
    updateDraft({
      sdk: {
        [field]: selectedPath,
      },
    });
  }

  async function applyDraft() {
    setIsApplying(true);
    setApplyError("");
    try {
      await onApply(draftSettings);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <section className="settings-dialog settings-dialog--preferences" aria-label="Settings">
      <div className="settings-dialog__panel settings-dialog__panel--wide">
        <header className="settings-dialog__header">
          <div>
            <h2>Settings</h2>
            <p>Common ArkLine configuration for SDK discovery, editor readability, and validation behavior.</p>
          </div>
          <button type="button" className="toolbar__button" disabled={isApplying} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="settings-dialog__body">
          <SettingsSidebar activeSection={activeSection} onSelectSection={setActiveSection} />

          <div className="settings-dialog__content">
            {activeSection === "sdk" ? (
              <SettingsSdkPanel
                environmentReport={environmentReport}
                onPickPath={(field) => { void pickDraftPath(field); }}
                saveStateLabel={saveStateLabel}
                settings={draftSettings}
                onChange={updateDraft}
                onRefreshEnvironment={onRefreshEnvironment}
              />
            ) : null}
            {activeSection === "editor" ? (
              <SettingsEditorPanel
                settings={draftSettings}
                onChange={updateDraft}
              />
            ) : null}
            {activeSection === "validation" ? (
              <SettingsValidationPanel
                settings={draftSettings}
                onChange={updateDraft}
              />
            ) : null}
          </div>
        </div>

        <footer className="settings-dialog__footer">
          {applyError ? <span className="settings-save-state settings-save-state--error">{applyError}</span> : null}
          <button type="button" className="toolbar__button" disabled={isApplying} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="toolbar__button toolbar__button--primary"
            disabled={!isDirty || isApplying}
            onClick={() => void applyDraft()}
          >
            {isApplying ? "Applying..." : "Apply"}
          </button>
        </footer>
      </div>
    </section>
  );
}
