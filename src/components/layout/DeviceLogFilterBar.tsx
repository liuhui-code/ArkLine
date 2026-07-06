import type { DeviceLogFilterState, DeviceLogLevel } from "@/features/device-log/device-log-model";

const LEVEL_FILTERS: Array<{ label: string; level: DeviceLogLevel }> = [
  { label: "Error", level: "error" },
  { label: "Warn", level: "warn" },
  { label: "Info", level: "info" },
  { label: "Debug", level: "debug" },
  { label: "Fatal", level: "fatal" },
];

type DeviceLogFilterBarProps = {
  error: string | null;
  filter: DeviceLogFilterState;
  onChange: (patch: Partial<DeviceLogFilterState>) => void;
  onClear: () => void;
};

export function DeviceLogFilterBar({ error, filter, onChange, onClear }: DeviceLogFilterBarProps) {
  return (
    <div className="device-log-tool-window__filters">
      <input
        aria-label="Filter device logs"
        value={filter.query}
        onChange={(event) => onChange({ query: event.target.value })}
        placeholder="Filter logs"
      />
      <div className="device-log-tool-window__level-filters" aria-label="Log level filters">
        {LEVEL_FILTERS.map(({ label, level }) => (
          <button
            key={level}
            type="button"
            className={filter.levels.includes(level) ? "device-log-tool-window__filter-chip--active" : ""}
            aria-pressed={filter.levels.includes(level)}
            aria-label={`${label} Logs`}
            onClick={() => onChange({ levels: toggleLevel(filter.levels, level) })}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        aria-label="Filter log process"
        value={filter.process}
        onChange={(event) => onChange({ process: event.target.value })}
        placeholder="Process"
      />
      <input
        aria-label="Filter log pid"
        value={filter.pid}
        onChange={(event) => onChange({ pid: event.target.value })}
        placeholder="PID"
      />
      <input
        aria-label="Filter log domain"
        value={filter.domain}
        onChange={(event) => onChange({ domain: event.target.value })}
        placeholder="Domain"
      />
      <input
        aria-label="Filter log tag"
        value={filter.tag}
        onChange={(event) => onChange({ tag: event.target.value })}
        placeholder="Tag"
      />
      <label>
        <input
          type="checkbox"
          checked={filter.regex}
          onChange={(event) => onChange({ regex: event.target.checked })}
        />
        Regex
      </label>
      <label>
        <input
          type="checkbox"
          checked={filter.matchCase}
          onChange={(event) => onChange({ matchCase: event.target.checked })}
        />
        Match Case
      </label>
      <button type="button" onClick={onClear} aria-label="Clear Log Filters">
        Clear Filters
      </button>
      {error ? <span className="device-log-tool-window__filter-error">{error}</span> : null}
    </div>
  );
}

function toggleLevel(levels: DeviceLogLevel[], level: DeviceLogLevel) {
  return levels.includes(level) ? levels.filter((item) => item !== level) : [...levels, level];
}
