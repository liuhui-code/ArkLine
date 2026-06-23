import type { AppSettingsPatch, AppSettings } from "@/features/settings/settings-store";
import type { EnvironmentReport } from "@/features/workspace/workspace-api";

type SettingsSdkPanelProps = {
  environmentReport: EnvironmentReport | null;
  onPickPath: (field: "harmonySdkPath" | "semanticWorkerPath" | "nodePath") => void;
  saveStateLabel: string;
  settings: AppSettings;
  onChange: (update: AppSettingsPatch) => void;
  onRefreshEnvironment: () => void;
};

type PathHint = { tone: "neutral" | "warning" | "ready"; text: string };

function sdkPathHint(settings: AppSettings): PathHint {
  if (settings.sdk.harmonySdkPath.trim()) {
    return {
      tone: "warning",
      text: "SDK path has not been verified yet. Apply and check Environment Status for the authoritative result.",
    };
  }

  if (settings.sdk.autoDetect) {
    return {
      tone: "neutral",
      text: "ArkLine will try to auto-detect the SDK.",
    };
  }

  return {
    tone: "warning",
    text: "SDK path is empty and auto-detect is off; semantic features may use fallback.",
  };
}

function nodePathHint(settings: AppSettings): PathHint {
  if (settings.sdk.nodePath.trim()) {
    return {
      tone: "warning",
      text: "Node directory has not been verified yet. Apply and check Environment Status for the authoritative result.",
    };
  }

  return {
    tone: "neutral",
    text: "ArkLine will resolve node from PATH.",
  };
}

function SettingsHint({ hint, id }: { hint: PathHint; id: string }) {
  return <span id={id} className={`settings-field__hint settings-field__hint--${hint.tone}`}>{hint.text}</span>;
}

export function SettingsSdkPanel({
  environmentReport,
  onPickPath,
  saveStateLabel,
  settings,
  onChange,
  onRefreshEnvironment,
}: SettingsSdkPanelProps) {
  const tools = environmentReport?.tools ?? [];

  return (
    <section className="settings-section" aria-label="SDK & Tools Settings">
      <header className="settings-section__header">
        <div>
          <h3>SDK &amp; Tools</h3>
          <p>Paths and runtime dependencies used for ArkTS indexing, navigation, and validation.</p>
        </div>
        <div className="settings-section__actions">
          <span className="settings-save-state">{saveStateLabel}</span>
          <button type="button" className="toolbar__button" onClick={onRefreshEnvironment}>
            Check Environment
          </button>
        </div>
      </header>

      <section className="settings-group" aria-label="SDK Discovery">
        <div className="settings-group__header">
          <h4>SDK Discovery</h4>
          <p>Point ArkLine at the HarmonyOS SDK first, then override worker and runtime only when needed.</p>
        </div>

        <label className="settings-toggle">
          <input
            aria-label="Auto Detect SDK"
            checked={settings.sdk.autoDetect}
            type="checkbox"
            onChange={(event) =>
              onChange({
                sdk: {
                  autoDetect: event.target.checked,
                },
              })
            }
          />
          <span>Auto detect SDK and toolchain paths</span>
        </label>

        <label className="settings-field settings-field--stacked">
          <span>HarmonyOS / ArkTS SDK Path</span>
          <div className="settings-input-row">
            <input
              aria-label="HarmonyOS / ArkTS SDK Path"
              aria-describedby="harmony-sdk-path-hint"
              className="panel-input"
              value={settings.sdk.harmonySdkPath}
              placeholder="C:/Huawei/DevEco Studio/sdk"
              onChange={(event) =>
                onChange({
                  sdk: {
                    harmonySdkPath: event.target.value,
                  },
                })
              }
            />
            <button
              aria-label="Browse HarmonyOS / ArkTS SDK Path"
              type="button"
              className="toolbar__button"
              onClick={() => onPickPath("harmonySdkPath")}
            >
              Browse...
            </button>
          </div>
          <SettingsHint id="harmony-sdk-path-hint" hint={sdkPathHint(settings)} />
        </label>
      </section>

      <section className="settings-group" aria-label="Runtime Overrides">
        <div className="settings-group__header">
          <h4>Runtime Overrides</h4>
          <p>Keep these empty unless you need to pin ArkLine to a specific worker build or Node runtime.</p>
        </div>

        <label className="settings-field settings-field--stacked">
          <span>ArkTS LSP / Semantic Worker Path</span>
          <div className="settings-input-row">
            <input
              aria-label="ArkTS LSP / Semantic Worker Path"
              className="panel-input"
              value={settings.sdk.semanticWorkerPath}
              placeholder="Optional override path"
              onChange={(event) =>
                onChange({
                  sdk: {
                    semanticWorkerPath: event.target.value,
                  },
                })
              }
            />
            <button
              aria-label="Browse ArkTS LSP / Semantic Worker Path"
              type="button"
              className="toolbar__button"
              onClick={() => onPickPath("semanticWorkerPath")}
            >
              Browse...
            </button>
          </div>
        </label>

        <label className="settings-field settings-field--stacked">
          <span>Node Path</span>
          <div className="settings-input-row">
            <input
              aria-label="Node Path"
              aria-describedby="node-path-hint"
              className="panel-input"
              value={settings.sdk.nodePath}
              placeholder="Optional override path"
              onChange={(event) =>
                onChange({
                  sdk: {
                    nodePath: event.target.value,
                  },
                })
              }
            />
            <button
              aria-label="Browse Node Path"
              type="button"
              className="toolbar__button"
              onClick={() => onPickPath("nodePath")}
            >
              Browse...
            </button>
          </div>
          <SettingsHint id="node-path-hint" hint={nodePathHint(settings)} />
        </label>
      </section>

      <section className="settings-group" aria-label="Environment Status">
        <div className="settings-group__header">
          <h4>Environment Status</h4>
          <p>Quick health snapshot for the toolchain ArkLine relies on during review and navigation.</p>
        </div>

        <div className="settings-status">
          {tools.length === 0 ? (
            <div className="settings-status__item settings-status__item--empty">
              <strong>No checks reported</strong>
              <span>Run Check Environment to inspect the current machine.</span>
            </div>
          ) : null}
          {tools.map((tool) => (
            <div key={tool.name} className={`settings-status__item settings-status__item--${tool.available ? "ok" : "warn"}`}>
              <strong>{tool.name}</strong>
              <span>{tool.detail}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
