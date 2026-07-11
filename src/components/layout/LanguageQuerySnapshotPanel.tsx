import type { LanguageQuerySnapshotRecord } from "@/components/layout/language-query-snapshot-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

export function LanguageQuerySnapshotPanel({ records }: { records: LanguageQuerySnapshotRecord[] }) {
  return (
    <section className="index-diagnostics__section" aria-label="Language Query Snapshots">
      <div className="index-diagnostics__section-title">
        <h3>Language Query Snapshots</h3>
        <span>{records.length} recent</span>
      </div>
      {records.length > 0 ? records.map((record) => (
        <div className="index-diagnostics__event" key={record.id}>
          <span>{record.kind} · {getPathBasename(record.path)}:{record.line}:{record.column}</span>
          <strong>{record.contentClass}</strong>
          <code>{record.contentLength.toLocaleString()} chars</code>
        </div>
      )) : (
        <div className="index-diagnostics__empty">No language query snapshots yet.</div>
      )}
    </section>
  );
}
