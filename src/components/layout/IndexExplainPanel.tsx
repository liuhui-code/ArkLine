import type { WorkspaceIndexExplainResult } from "@/features/workspace/workspace-api";

type IndexExplainPanelProps = {
  result: WorkspaceIndexExplainResult;
  query: string;
  onClose: () => void;
  onRebuildIndex: () => void;
  onOpenSettings: () => void;
  onRetryQuery: () => void;
};

export function IndexExplainPanel({
  result,
  query,
  onClose,
  onRebuildIndex,
  onOpenSettings,
  onRetryQuery,
}: IndexExplainPanelProps) {
  return (
    <section className="index-explain-panel" aria-label="Index Explain Panel">
      <div className="index-explain-panel__header">
        <div>
          <h3>Index Explain</h3>
          <p>{result.message}</p>
        </div>
        <button type="button" className="editor-query-panel__close" aria-label="Close Index Explain" onClick={onClose}>
          x
        </button>
      </div>
      <div className="index-explain-panel__meta">
        <span>{result.status}</span>
        <span>{query}</span>
      </div>
      <div className="index-explain-panel__facts" role="table" aria-label="Index Explain Facts">
        <div className="index-explain-panel__fact index-explain-panel__fact--header" role="row">
          <span role="columnheader">Category</span>
          <span role="columnheader">Evidence</span>
        </div>
        {result.facts.length > 0 ? result.facts.map((fact) => (
          <div className="index-explain-panel__fact" role="row" key={`${fact.category}:${fact.evidence}`}>
            <span role="cell">{fact.category}</span>
            <span role="cell">{fact.evidence}</span>
          </div>
        )) : (
          <div className="index-explain-panel__fact" role="row">
            <span role="cell">status</span>
            <span role="cell">No additional facts were recorded.</span>
          </div>
        )}
      </div>
      {result.recommendedAction ? (
        <div className="index-explain-panel__recommendation">
          Recommendation: {result.recommendedAction}
        </div>
      ) : null}
      <div className="index-explain-panel__actions">
        <button type="button" className="toolbar__button toolbar__button--primary" onClick={onRetryQuery}>Retry Query</button>
        <button type="button" className="toolbar__button" onClick={onRebuildIndex}>Rebuild Index</button>
        <button type="button" className="toolbar__button" onClick={onOpenSettings}>Open Settings</button>
      </div>
    </section>
  );
}
