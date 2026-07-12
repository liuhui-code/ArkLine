import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";
import type { UiLatencySample } from "@/features/performance/ui-latency-monitor";
import type { IpcLatencySample } from "@/features/performance/ipc-latency-store";
import type { RenderPressureSample } from "@/features/performance/render-pressure-store";
import { formatClockTime } from "@/components/layout/index-diagnostics-model";

type IndexDiagnosticsPerformanceTimelineSectionProps = {
  timelineCount: number;
  diagnosticsTimeline: WorkspaceIndexDiagnostics["timeline"];
  uiLatencySamples: UiLatencySample[];
  ipcLatencySamples: IpcLatencySample[];
  renderPressureSamples: RenderPressureSample[];
};

export function IndexDiagnosticsPerformanceTimelineSection({
  timelineCount,
  diagnosticsTimeline,
  uiLatencySamples,
  ipcLatencySamples,
  renderPressureSamples,
}: IndexDiagnosticsPerformanceTimelineSectionProps) {
  return (
    <section className="index-diagnostics__section" id="index-diagnostics-timeline" aria-label="Performance Timeline">
      <div className="index-diagnostics__section-title">
        <h3>Performance Timeline</h3>
        <span>{timelineCount} events</span>
      </div>
      <div className="index-diagnostics__timeline">
        {renderPressureSamples.map((item) => (
          <div className="index-diagnostics__timeline-item" key={`render:${item.label}`}>
            <span className="index-diagnostics__severity index-diagnostics__severity--info">render</span>
            <div>
              <strong>{item.label}</strong>
              <span>{item.count.toLocaleString()} renders</span>
            </div>
            <span>{formatClockTime(item.lastRenderedAt)}</span>
          </div>
        ))}
        {ipcLatencySamples.map((item, index) => (
          <div className="index-diagnostics__timeline-item" key={`ipc:${item.command}:${item.startedAt}:${index}`}>
            <span className={`index-diagnostics__severity index-diagnostics__severity--${item.status === "error" ? "error" : "info"}`}>ipc</span>
            <div>
              <strong>{item.command}</strong>
              <span>{item.status}</span>
            </div>
            <span>{item.durationMs}ms</span>
          </div>
        ))}
        {uiLatencySamples.map((item, index) => (
          <div className="index-diagnostics__timeline-item" key={`${item.kind}:${item.startedAt}:${index}`}>
            <span className="index-diagnostics__severity index-diagnostics__severity--warning">ui</span>
            <div>
              <strong>UI responsiveness</strong>
              <span>{item.kind} · {item.label}</span>
            </div>
            <span>{item.durationMs}ms</span>
          </div>
        ))}
        {diagnosticsTimeline.length > 0 ? diagnosticsTimeline.map((item, index) => (
          <div className="index-diagnostics__timeline-item" key={`${item.taskId ?? item.title}:${item.occurredAt}:${index}`}>
            <span className={`index-diagnostics__severity index-diagnostics__severity--${item.severity}`}>{item.severity}</span>
            <div>
              <strong>{item.title}</strong>
              <span>{item.message}</span>
            </div>
            <span>{item.durationMs == null ? "start" : `${item.durationMs}ms`}</span>
          </div>
        )) : null}
        {timelineCount === 0 ? (
          <div className="index-diagnostics__empty">No timeline events yet.</div>
        ) : null}
      </div>
    </section>
  );
}
