import type { WorkspaceIndexFileReadiness } from "@/features/workspace/workspace-api";
import { IndexDiagnosticsMetric } from "@/components/layout/IndexDiagnosticsMetric";

type IndexDiagnosticsCurrentFileSectionProps = {
  activePath: string | null;
  currentFileDirty: boolean;
  fileReadiness: WorkspaceIndexFileReadiness | null;
};

export function IndexDiagnosticsCurrentFileSection({
  activePath,
  currentFileDirty,
  fileReadiness,
}: IndexDiagnosticsCurrentFileSectionProps) {
  return (
    <section className="index-diagnostics__section" id="index-diagnostics-current-file" aria-label="Current File Readiness">
      <div className="index-diagnostics__section-title">
        <h3>Current File Readiness</h3>
        <span>{fileReadiness?.fileName ?? activePath ?? "No file"}</span>
      </div>
      <p className="index-diagnostics__reason">
        {fileReadiness?.reason ?? "No current file readiness evidence is available."}
      </p>
      <div className="index-diagnostics__grid">
        <IndexDiagnosticsMetric label="Discovery" value={fileReadiness?.discoveryIndex ?? "unknown"} />
        <IndexDiagnosticsMetric label="FileIndex" value={fileReadiness?.fileIndex ?? "unknown"} />
        <IndexDiagnosticsMetric label="ContentIndex" value={fileReadiness?.contentIndex ?? "unknown"} />
        <IndexDiagnosticsMetric label="SymbolIndex" value={fileReadiness?.symbolIndex ?? "unknown"} />
        <IndexDiagnosticsMetric label="Parser" value={fileReadiness?.parserStatus ?? "unknown"} />
        <IndexDiagnosticsMetric label="Generation" value={String(fileReadiness?.indexedGeneration ?? "none")} />
        <IndexDiagnosticsMetric label="Editor dirty" value={currentFileDirty ? "newer than index" : "clean"} />
        <IndexDiagnosticsMetric label="Ctrl+Click" value={fileReadiness?.definitionAvailable ? "available" : "blocked"} />
        <IndexDiagnosticsMetric label="Completion" value={fileReadiness?.completionAvailable ? "available" : "blocked"} />
        <IndexDiagnosticsMetric label="Usages" value={fileReadiness?.usagesAvailable ? "available" : "blocked"} />
        <IndexDiagnosticsMetric label="Search" value={fileReadiness?.searchAvailable ? "available" : "blocked"} />
      </div>
    </section>
  );
}
