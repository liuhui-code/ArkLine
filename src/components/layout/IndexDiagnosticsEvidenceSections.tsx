import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

type ParserFailure = WorkspaceIndexDiagnostics["parserFailures"][number];
type UnresolvedImport = WorkspaceIndexDiagnostics["unresolvedImports"][number];

type ParserErrorsSectionProps = {
  parserFailures: ParserFailure[];
};

type UnresolvedImportsSectionProps = {
  unresolvedImports: UnresolvedImport[];
};

export function IndexDiagnosticsParserErrorsSection({ parserFailures }: ParserErrorsSectionProps) {
  return (
    <section className="index-diagnostics__section" id="index-diagnostics-parser-errors" aria-label="Top Parser Errors">
      <div className="index-diagnostics__section-title">
        <h3>Top Parser Errors</h3>
        <span>{parserFailures.length} files</span>
      </div>
      {parserFailures.length > 0 ? parserFailures.map((failure) => (
        <div className="index-diagnostics__event" key={`${failure.path}:${failure.line}:${failure.column}`}>
          <span>{failure.path}:{failure.line}:{failure.column}</span>
          <strong>{failure.message}</strong>
        </div>
      )) : (
        <div className="index-diagnostics__empty">No parser errors recorded.</div>
      )}
    </section>
  );
}

export function IndexDiagnosticsUnresolvedImportsSection({ unresolvedImports }: UnresolvedImportsSectionProps) {
  return (
    <section className="index-diagnostics__section" id="index-diagnostics-unresolved-imports" aria-label="Unresolved Imports">
      <div className="index-diagnostics__section-title">
        <h3>Unresolved Imports</h3>
        <span>{unresolvedImports.length} imports</span>
      </div>
      {unresolvedImports.length > 0 ? unresolvedImports.map((item) => (
        <div className="index-diagnostics__event" key={`${item.fromPath}:${item.sourceModule}:${item.line}:${item.column}`}>
          <span>{item.fromPath}:{item.line}:{item.column}</span>
          <strong>{item.sourceModule}</strong>
        </div>
      )) : (
        <div className="index-diagnostics__empty">No unresolved imports recorded.</div>
      )}
    </section>
  );
}
