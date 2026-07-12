import type { QueryEnvelopeExplainSummary } from "@/features/workspace/workspace-query-explain-model";
import type { buildQueryExplainTimeline } from "@/features/workspace/workspace-query-explain-model";

type QueryExplainTimelineItem = ReturnType<typeof buildQueryExplainTimeline>[number];

type IndexDiagnosticsQueryExplainSectionProps = {
  queryTimeline: QueryExplainTimelineItem[];
  recentCount: number;
};

export function IndexDiagnosticsQueryExplainSection({
  queryTimeline,
  recentCount,
}: IndexDiagnosticsQueryExplainSectionProps) {
  return (
    <section className="index-diagnostics__section" id="index-diagnostics-query-explain" aria-label="Query Explain">
      <div className="index-diagnostics__section-title">
        <h3>Query Explain</h3>
        <span>{recentCount} recent</span>
      </div>
      {queryTimeline.length > 0 ? queryTimeline.map((event) => (
        <div className="index-diagnostics__event" key={event.id}>
          <span>{event.title}</span>
          <span>{event.displayTime}</span>
          <strong>{event.message}</strong>
          <QueryExplainSummary summary={event.summary} />
          <code>{event.raw}</code>
        </div>
      )) : null}
      {queryTimeline.length === 0 ? (
        <div className="index-diagnostics__empty">No query explain events yet.</div>
      ) : null}
    </section>
  );
}

function QueryExplainSummary({ summary }: { summary: QueryEnvelopeExplainSummary | null }) {
  if (!summary) {
    return null;
  }
  const rows = [
    ["Action", summary.action],
    ["Used", summary.used],
    ["Skipped", summary.skipped],
    ["Readiness", summary.readiness],
    ["Result count", summary.resultCount],
    ["Generation", summary.generation],
    ["Retryable", summary.retryable],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (rows.length === 0) {
    return null;
  }

  return (
    <dl className="index-diagnostics__explain-summary" aria-label="Query explain evidence">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
