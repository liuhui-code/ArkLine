import type { SemanticState } from "@/features/semantic/semantic-store";
import { IndexDiagnosticsMetric } from "@/components/layout/IndexDiagnosticsMetric";

type IndexDiagnosticsSemanticHostSectionProps = {
  semanticState: SemanticState;
};

export function IndexDiagnosticsSemanticHostSection({
  semanticState,
}: IndexDiagnosticsSemanticHostSectionProps) {
  const supervisor = semanticState.supervisor;
  const runtime = supervisor?.runtime;
  const requestActor = supervisor?.requestActor;

  return (
    <section
      className="index-diagnostics__section"
      id="index-diagnostics-semantic-host"
      aria-label="Semantic Host"
    >
      <div className="index-diagnostics__section-title">
        <h3>Semantic Host</h3>
        <span>{semanticState.provider}</span>
      </div>
      <div className="index-diagnostics__grid">
        <IndexDiagnosticsMetric label="State" value={supervisor?.status ?? semanticState.mode} />
        <IndexDiagnosticsMetric label="Restarts" value={String(supervisor?.restartCount ?? 0)} />
        <IndexDiagnosticsMetric label="Restored docs" value={String(supervisor?.restoredDocumentCount ?? 0)} />
        <IndexDiagnosticsMetric label="Failures" value={String(supervisor?.consecutiveFailures ?? 0)} />
        <IndexDiagnosticsMetric label="Backoff" value={formatDuration(supervisor?.retryAfterMs ?? 0)} />
        <IndexDiagnosticsMetric label="RSS" value={formatBytes(runtime?.rssBytes)} />
        <IndexDiagnosticsMetric label="Heap" value={formatBytes(runtime?.heapUsedBytes)} />
        <IndexDiagnosticsMetric label="Memory budget" value={formatBytes(supervisor?.memoryBudgetBytes)} />
        <IndexDiagnosticsMetric label="Uptime" value={formatDuration(runtime?.uptimeMs ?? 0)} />
        <IndexDiagnosticsMetric
          label="Semantic requests"
          value={requestActor ? `${requestActor.running ? 1 : 0} running / ${requestActor.queued} queued` : "not sampled"}
        />
        <IndexDiagnosticsMetric
          label="Completed / superseded"
          value={requestActor ? `${requestActor.completed} / ${requestActor.superseded}` : "not sampled"}
        />
        <IndexDiagnosticsMetric label="Request failures" value={String(requestActor?.failed ?? 0)} />
        <IndexDiagnosticsMetric label="Workspace prepare p95" value={formatLatency(runtime, "workspacePrepare")} />
        <IndexDiagnosticsMetric label="Type prepare p95" value={formatLatency(runtime, "typePrepare")} />
        <IndexDiagnosticsMetric label="Completion p95" value={formatLatency(runtime, "completion")} />
        <IndexDiagnosticsMetric label="Definition p95" value={formatLatency(runtime, "gotoDefinition")} />
        <IndexDiagnosticsMetric label="Signature p95" value={formatLatency(runtime, "signatureHelp")} />
        <IndexDiagnosticsMetric
          label="Heartbeat"
          value={formatHeartbeat(supervisor?.lastHeartbeatEpochMs)}
        />
        <IndexDiagnosticsMetric label="Last error" value={supervisor?.lastError ?? "none"} />
      </div>
    </section>
  );
}

function formatBytes(value?: number) {
  if (!value) return "not sampled";
  return `${(value / 1024 / 1024).toFixed(0)} MiB`;
}

function formatDuration(value: number) {
  if (value <= 0) return "none";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function formatHeartbeat(value?: number | null) {
  if (!value) return "not sampled";
  return new Date(value).toLocaleTimeString();
}

function formatLatency(
  runtime: { providerLatencies?: Record<string, { count: number; p95Us: number }> } | null | undefined,
  provider: string,
) {
  const sample = runtime?.providerLatencies?.[provider];
  if (!sample) return "not sampled";
  const duration = sample.p95Us < 1000
    ? `${sample.p95Us} us`
    : `${(sample.p95Us / 1000).toFixed(1)} ms`;
  return `${duration} / ${sample.count}`;
}
