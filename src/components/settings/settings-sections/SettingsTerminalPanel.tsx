import type { AppSettings, AppSettingsPatch, TerminalProfile } from "@/features/settings/settings-store";

type SettingsTerminalPanelProps = {
  settings: AppSettings;
  onChange: (update: AppSettingsPatch) => void;
};

const profiles: Array<{ value: TerminalProfile; label: string }> = [
  { value: "system", label: "System default" },
  { value: "gitBash", label: "Git Bash (Windows)" },
  { value: "powerShell", label: "PowerShell" },
  { value: "commandPrompt", label: "Command Prompt (Windows)" },
  { value: "custom", label: "Custom executable" },
];

function profileHint(profile: TerminalProfile) {
  if (profile === "gitBash") {
    return "Uses Git Bash's bash.exe. git.exe itself is a command-line tool, not an interactive shell.";
  }
  if (profile === "custom") {
    return "The executable is checked when you click Apply. New sessions use this profile.";
  }
  if (profile === "system") {
    return "Uses the host default shell: $SHELL on macOS/Linux, or the Windows default shell.";
  }
  return "This profile is available on Windows and uses the matching system executable.";
}

export function SettingsTerminalPanel({ settings, onChange }: SettingsTerminalPanelProps) {
  const terminal = settings.terminal;
  const customProfile = terminal.profile === "custom";

  return (
    <section className="settings-section" aria-label="Terminal Settings">
      <header className="settings-section__header">
        <div>
          <h3>Terminal</h3>
          <p>Choose the shell used when ArkLine creates a new integrated terminal session.</p>
        </div>
      </header>

      <section className="settings-group" aria-label="Terminal Profile">
        <div className="settings-group__header">
          <h4>Default Profile</h4>
          <p>Changing this setting affects new sessions. Existing sessions keep their current process.</p>
        </div>

        <label className="settings-field settings-field--stacked">
          <span>Shell profile</span>
          <select
            aria-label="Terminal shell profile"
            className="panel-input"
            value={terminal.profile}
            onChange={(event) => onChange({ terminal: { profile: event.target.value as TerminalProfile } })}
          >
            {profiles.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
          </select>
          <span className="settings-field__hint settings-field__hint--neutral">{profileHint(terminal.profile)}</span>
        </label>
      </section>

      {customProfile ? (
        <section className="settings-group" aria-label="Custom Terminal Profile">
          <div className="settings-group__header">
            <h4>Custom Shell</h4>
            <p>Use an absolute path or an executable available on PATH. Arguments are optional.</p>
          </div>

          <label className="settings-field settings-field--stacked">
            <span>Executable path</span>
            <input
              aria-label="Custom terminal executable path"
              className="panel-input"
              value={terminal.customExecutablePath}
              placeholder="C:\\Program Files\\Git\\bin\\bash.exe"
              onChange={(event) => onChange({ terminal: { customExecutablePath: event.target.value } })}
            />
          </label>
          <label className="settings-field settings-field--stacked">
            <span>Arguments</span>
            <input
              aria-label="Custom terminal arguments"
              className="panel-input"
              value={terminal.customArgs}
              placeholder="--login"
              onChange={(event) => onChange({ terminal: { customArgs: event.target.value } })}
            />
            <span className="settings-field__hint settings-field__hint--neutral">Use a single line; quoted arguments are supported.</span>
          </label>
        </section>
      ) : null}
    </section>
  );
}
