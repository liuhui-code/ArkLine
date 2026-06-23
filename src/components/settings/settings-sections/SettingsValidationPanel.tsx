import type { AppSettings, AppSettingsPatch } from "@/features/settings/settings-store";

type SettingsValidationPanelProps = {
  settings: AppSettings;
  onChange: (update: AppSettingsPatch) => void;
};

export function SettingsValidationPanel({ settings, onChange }: SettingsValidationPanelProps) {
  return (
    <section className="settings-section" aria-label="Validation Settings">
      <header className="settings-section__header">
        <div>
          <h3>Validation</h3>
          <p>Only keep the fast review-oriented checks here: lint, format, and timeout behavior.</p>
        </div>
      </header>

      <section className="settings-group" aria-label="Validation Behavior">
        <div className="settings-group__header">
          <h4>Behavior</h4>
          <p>Keep automatic formatting predictable and bounded.</p>
        </div>

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
          <span>Validation Timeout (ms)</span>
          <input
            aria-label="Validation Timeout (ms)"
            className="panel-input"
            type="number"
            step="100"
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
      </section>

      <section className="settings-group" aria-label="Validation Commands">
        <div className="settings-group__header">
          <h4>Commands</h4>
          <p>Override these only when the machine does not expose the expected ArkTS tools on PATH.</p>
        </div>

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
      </section>
    </section>
  );
}
