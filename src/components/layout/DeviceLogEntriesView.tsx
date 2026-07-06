import type { RefObject, UIEvent } from "react";
import { DeviceLogMessage } from "@/components/layout/DeviceLogEntryDetails";
import type { DeviceLogEntry, DeviceLogFilterState } from "@/features/device-log/device-log-model";

type DeviceLogEntriesViewProps = {
  entriesRef: RefObject<HTMLDivElement | null>;
  filter: DeviceLogFilterState;
  followingTail: boolean;
  liveWindowText: string;
  querySummary: string;
  renderedEntries: DeviceLogEntry[];
  selectedEntry: DeviceLogEntry | null;
  virtualHeight: number;
  virtualTop: number;
  visibleEntries: DeviceLogEntry[];
  canLoadOlder: boolean;
  loadingOlder: boolean;
  querying: boolean;
  onEntrySelect: (entry: DeviceLogEntry) => void;
  onFollowTail: () => void;
  onLoadOlder: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
};

export function DeviceLogEntriesView({
  entriesRef,
  filter,
  followingTail,
  liveWindowText,
  querySummary,
  renderedEntries,
  selectedEntry,
  virtualHeight,
  virtualTop,
  visibleEntries,
  canLoadOlder,
  loadingOlder,
  querying,
  onEntrySelect,
  onFollowTail,
  onLoadOlder,
  onScroll,
}: DeviceLogEntriesViewProps) {
  return (
    <div ref={entriesRef} className="device-log-tool-window__entries" role="log" aria-label="Device Log Entries" onScroll={onScroll}>
      {visibleEntries.length === 0 ? (
        <>
          {querying || querySummary ? (
            <div className="device-log-tool-window__render-stats">{querying ? "Searching logs..." : querySummary}</div>
          ) : null}
          <LoadOlderButton canLoadOlder={canLoadOlder} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} />
          <p className="device-log-tool-window__empty">No log entries</p>
        </>
      ) : (
        <>
          <div className="device-log-tool-window__render-stats">
            {querying ? "Searching logs..." : querySummary || liveWindowText} · {renderedEntries.length.toLocaleString()} rendered
          </div>
          <LoadOlderButton canLoadOlder={canLoadOlder} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} />
          {!followingTail ? (
            <button type="button" className="device-log-tool-window__follow-tail" onClick={onFollowTail}>
              Follow Tail
            </button>
          ) : null}
          <div className="device-log-tool-window__virtual-space" style={{ height: virtualHeight }}>
            <div className="device-log-tool-window__virtual-slice" style={{ transform: `translateY(${virtualTop}px)` }}>
              {renderedEntries.map((entry) => (
                <DeviceLogEntryRow
                  key={entry.id}
                  entry={entry}
                  filter={filter}
                  selected={selectedEntry?.id === entry.id}
                  onSelect={onEntrySelect}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type LoadOlderButtonProps = {
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
};

function LoadOlderButton({ canLoadOlder, loadingOlder, onLoadOlder }: LoadOlderButtonProps) {
  if (!canLoadOlder) {
    return null;
  }
  return (
    <button
      type="button"
      className="device-log-tool-window__follow-tail"
      disabled={loadingOlder}
      onClick={onLoadOlder}
      aria-label="Load Older Logs"
    >
      {loadingOlder ? "Loading..." : "Load Older"}
    </button>
  );
}

type DeviceLogEntryRowProps = {
  entry: DeviceLogEntry;
  filter: DeviceLogFilterState;
  selected: boolean;
  onSelect: (entry: DeviceLogEntry) => void;
};

function DeviceLogEntryRow({ entry, filter, selected, onSelect }: DeviceLogEntryRowProps) {
  return (
    <button
      type="button"
      data-testid="device-log-entry"
      className={`device-log-tool-window__entry device-log-tool-window__entry--${entry.level}${selected ? " device-log-tool-window__entry--selected" : ""}`}
      onClick={() => onSelect(entry)}
    >
      <span className="device-log-tool-window__entry-time">{entry.timestamp ?? "--"}</span>
      <span className="device-log-tool-window__entry-level">{entry.level}</span>
      <span className="device-log-tool-window__entry-pid">{entry.pid == null ? "-" : `${entry.pid}/${entry.tid ?? "-"}`}</span>
      <span className="device-log-tool-window__entry-tag">{entry.tag || "-"}</span>
      <DeviceLogMessage entry={entry} filter={filter} />
    </button>
  );
}
