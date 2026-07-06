import type { DeviceLogQueryWorkerEvent } from "@/features/workspace/workspace-api";
import "./device-log-query-diagnostics.css";

const SLOW_QUERY_MS = 250;

type DeviceLogQueryDiagnosticsProps = {
  events: DeviceLogQueryWorkerEvent[];
};

export function DeviceLogQueryDiagnostics({ events }: DeviceLogQueryDiagnosticsProps) {
  const recentEvents = events.slice(-5).reverse();
  if (recentEvents.length === 0) {
    return null;
  }
  const summary = summarizeQueryEvents(events);

  return (
    <section className="device-log-tool-window__query-diagnostics" role="region" aria-label="Query Diagnostics">
      <header>
        <strong>Query Diagnostics</strong>
        <span>{events.length.toLocaleString()} recent events</span>
      </header>
      <div className="device-log-tool-window__query-summary" aria-label="Query diagnostics summary">
        <span>{summary.failed.toLocaleString()} failed</span>
        <span>{summary.cancelled.toLocaleString()} cancelled</span>
        <span>{summary.slow.toLocaleString()} slow</span>
      </div>
      <div className="device-log-tool-window__query-events">
        {recentEvents.map((event) => (
          <article
            className={`device-log-tool-window__query-event device-log-tool-window__query-event--${event.status}`}
            key={event.sequence}
          >
            <span className="device-log-tool-window__query-status">{event.status}</span>
            <code>{event.query || "<empty>"}</code>
            <span>{event.durationMs.toLocaleString()}ms</span>
            {event.error ? <span className="device-log-tool-window__query-error">{event.error}</span> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function summarizeQueryEvents(events: DeviceLogQueryWorkerEvent[]) {
  return events.reduce(
    (summary, event) => ({
      failed: summary.failed + (event.status === "failed" ? 1 : 0),
      cancelled: summary.cancelled + (event.status === "cancelled" ? 1 : 0),
      slow: summary.slow + (event.durationMs >= SLOW_QUERY_MS ? 1 : 0),
    }),
    { failed: 0, cancelled: 0, slow: 0 },
  );
}
