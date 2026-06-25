import type { UsageResult, UsageSearchState } from "@/features/workspace/usage-search";
import { UsagesPanel } from "@/components/layout/UsagesPanel";

type EditorQueryPanelProps = {
  state: UsageSearchState;
  onClose: () => void;
  onOpenUsage: (item: UsageResult) => void;
};

function getQueryTitle(state: UsageSearchState) {
  if (state.status === "loading") {
    return "Finding Usages";
  }
  if (state.status === "ready") {
    return `Usages (${state.items.length})`;
  }
  if (state.status === "empty") {
    return "Usages";
  }
  if (state.status === "error") {
    return "Usage Query Failed";
  }
  return "Symbol Query";
}

function getQueryMeta(state: UsageSearchState) {
  const request = state.requestedSymbol;
  if (!request) {
    return "Current file";
  }
  return `${request.line}:${request.column}`;
}

export function EditorQueryPanel({ state, onClose, onOpenUsage }: EditorQueryPanelProps) {
  return (
    <section className="editor-query-panel" aria-label="Editor Query Panel">
      <div className="editor-query-panel__header">
        <div className="editor-query-panel__title">
          <strong>{getQueryTitle(state)}</strong>
          <span>{getQueryMeta(state)}</span>
        </div>
        <button type="button" className="editor-query-panel__close" aria-label="Close Query Panel" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="editor-query-panel__body">
        <UsagesPanel state={state} onOpenUsage={onOpenUsage} />
      </div>
    </section>
  );
}
