import { useState, type ReactNode } from "react";
import type { DeviceLogEntry, DeviceLogFilterState } from "@/features/device-log/device-log-model";
import { findDeviceLogHighlights } from "@/features/device-log/device-log-query";

type DeviceLogMessageProps = {
  entry: DeviceLogEntry;
  filter: DeviceLogFilterState;
};

export function DeviceLogMessage({ entry, filter }: DeviceLogMessageProps) {
  const ranges = findDeviceLogHighlights(entry.message, filter);
  if (ranges.length === 0) {
    return <span className="device-log-tool-window__entry-message" aria-label={entry.message}>{entry.message}</span>;
  }

  let cursor = 0;
  const parts: ReactNode[] = [];
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(<span key={`text-${index}`}>{entry.message.slice(cursor, range.start)}</span>);
    }
    parts.push(<mark key={`match-${index}`} className="device-log-tool-window__match">{entry.message.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  if (cursor < entry.message.length) {
    parts.push(<span key="tail">{entry.message.slice(cursor)}</span>);
  }

  return <span className="device-log-tool-window__entry-message" aria-label={entry.message}>{parts}</span>;
}

type DeviceLogInspectorProps = {
  entry: DeviceLogEntry | null;
  onClose: () => void;
  onFilterDomain: (domain: string) => void;
  onFilterPid: (pid: string) => void;
  onFilterTag: (tag: string) => void;
  onFilterProcess: (process: string) => void;
};

export function DeviceLogInspector({
  entry,
  onClose,
  onFilterDomain,
  onFilterPid,
  onFilterTag,
  onFilterProcess,
}: DeviceLogInspectorProps) {
  const [copyStatus, setCopyStatus] = useState("");
  if (!entry) {
    return null;
  }

  async function copyRawLog() {
    if (!navigator.clipboard?.writeText || !entry) {
      setCopyStatus("Copy unavailable");
      return;
    }
    await navigator.clipboard.writeText(entry.raw);
    setCopyStatus("Raw copied");
  }

  return (
    <aside className="device-log-tool-window__inspector" role="region" aria-label="Log Inspector">
      <header className="device-log-tool-window__inspector-header">
        <strong>{entry.level}</strong>
        <button type="button" onClick={onClose} aria-label="Close Log Inspector">x</button>
      </header>
      <dl className="device-log-tool-window__inspector-grid">
        <dt>Time</dt><dd>{entry.timestamp ?? "--"}</dd>
        <dt>Process</dt><dd>{entry.process || "-"}</dd>
        <dt>PID/TID</dt><dd>{entry.pid == null ? "-" : `${entry.pid}/${entry.tid ?? "-"}`}</dd>
        <dt>Domain</dt><dd>{entry.domain || "-"}</dd>
        <dt>Tag</dt><dd>{entry.tag || "-"}</dd>
      </dl>
      <pre className="device-log-tool-window__raw">{entry.raw}</pre>
      <footer className="device-log-tool-window__inspector-actions">
        <button type="button" onClick={() => void copyRawLog()} aria-label="Copy Raw Log">Copy Raw</button>
        <button type="button" disabled={!entry.tag} onClick={() => onFilterTag(entry.tag)}>Filter Tag</button>
        <button type="button" disabled={!entry.process} onClick={() => onFilterProcess(entry.process)}>Filter Process</button>
        <button type="button" disabled={entry.pid == null} onClick={() => onFilterPid(String(entry.pid))}>Filter PID</button>
        <button type="button" disabled={!entry.domain} onClick={() => onFilterDomain(entry.domain)}>Filter Domain</button>
        {copyStatus ? <span className="device-log-tool-window__status">{copyStatus}</span> : null}
      </footer>
    </aside>
  );
}
