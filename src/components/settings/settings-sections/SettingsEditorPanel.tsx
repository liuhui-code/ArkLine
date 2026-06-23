import type { AppSettings, AppSettingsPatch } from "@/features/settings/settings-store";

type SettingsEditorPanelProps = {
  settings: AppSettings;
  onChange: (update: AppSettingsPatch) => void;
};

const previewCode = [
  "@Entry",
  "@Component",
  "struct Index {",
  "  build() {",
  "    Column() {",
  '      Text("ArkLine")',
  "    }",
  "  }",
  "}",
].join("\n");

export function SettingsEditorPanel({ settings, onChange }: SettingsEditorPanelProps) {
  const previewStyle = {
    fontFamily: settings.editor.fontFamily,
    fontSize: `${settings.editor.fontSize}px`,
    lineHeight: `${settings.editor.lineHeight}`,
    letterSpacing: `${settings.editor.letterSpacing}px`,
  };

  return (
    <section className="settings-section" aria-label="Editor Settings">
      <header className="settings-section__header">
        <div>
          <h3>Editor</h3>
          <p>Keep code reading comfortable first. These values feed the live editor and preview together.</p>
        </div>
      </header>

      <section className="settings-group" aria-label="Editor Readability">
        <div className="settings-group__header">
          <h4>Readability</h4>
          <p>These are the settings that most affect long-form code review comfort.</p>
        </div>

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

        <div className="settings-grid">
          <label className="settings-field">
            <span>Font Size</span>
            <input
              aria-label="Font Size"
              className="panel-input"
              type="number"
              step="1"
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

          <label className="settings-field">
            <span>Line Height</span>
            <input
              aria-label="Line Height"
              className="panel-input"
              type="number"
              step="0.05"
              value={settings.editor.lineHeight}
              onChange={(event) =>
                onChange({
                  editor: {
                    lineHeight: Number(event.target.value),
                  },
                })
              }
            />
          </label>

          <label className="settings-field">
            <span>Letter Spacing</span>
            <input
              aria-label="Letter Spacing"
              className="panel-input"
              type="number"
              step="0.05"
              value={settings.editor.letterSpacing}
              onChange={(event) =>
                onChange({
                  editor: {
                    letterSpacing: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      </section>

      <div className="settings-preview">
        <div className="settings-preview__label">Preview</div>
        <pre className="settings-preview__code" style={previewStyle}>{previewCode}</pre>
      </div>
    </section>
  );
}
