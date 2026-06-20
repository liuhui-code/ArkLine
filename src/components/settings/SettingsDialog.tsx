import type { AppSettings, AppSettingsPatch } from "@/features/settings/settings-store";

type SettingsDialogProps = {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onChange: (update: AppSettingsPatch) => void;
};

export function SettingsDialog({ open, settings, onClose, onChange }: SettingsDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <section className="settings-dialog" aria-label="Settings">
      <div className="settings-dialog__panel">
        <header className="settings-dialog__header">
          <h2>Settings</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <label className="settings-field">
          <span>Editor Font</span>
          <input
            aria-label="Editor Font"
            className="panel-input"
            value={settings.editor.fontFamily}
            onChange={(event) =>
              onChange({
                editor: {
                  fontFamily: event.target.value,
                },
              })
            }
          />
        </label>
        <label className="settings-field">
          <span>Font Size</span>
          <input
            aria-label="Font Size"
            className="panel-input"
            type="number"
            value={settings.editor.fontSize}
            onChange={(event) =>
              onChange({
                editor: {
                  fontSize: Number(event.target.value),
                },
              })
            }
          />
        </label>
        <label className="settings-toggle">
          <input
            aria-label="Format on save"
            checked={settings.validation.formatOnSave}
            type="checkbox"
            onChange={(event) =>
              onChange({
                validation: {
                  formatOnSave: event.target.checked,
                },
              })
            }
          />
          <span>Format on save</span>
        </label>
        <label className="settings-field">
          <span>Lint Command</span>
          <input
            aria-label="Lint Command"
            className="panel-input"
            value={settings.validation.lintCommand}
            onChange={(event) =>
              onChange({
                validation: {
                  lintCommand: event.target.value,
                },
              })
            }
          />
        </label>
        <label className="settings-field">
          <span>Format Command</span>
          <input
            aria-label="Format Command"
            className="panel-input"
            value={settings.validation.formatCommand}
            onChange={(event) =>
              onChange({
                validation: {
                  formatCommand: event.target.value,
                },
              })
            }
          />
        </label>
        <label className="settings-field">
          <span>Validation Timeout (ms)</span>
          <input
            aria-label="Validation Timeout (ms)"
            className="panel-input"
            type="number"
            value={settings.validation.timeoutMs}
            onChange={(event) =>
              onChange({
                validation: {
                  timeoutMs: Number(event.target.value),
                },
              })
            }
          />
        </label>
      </div>
    </section>
  );
}
