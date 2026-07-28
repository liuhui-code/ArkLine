import { useEffect } from "react";
import { PaletteShell } from "@/components/layout/PaletteShell";
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
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [onClose]);

  return (
    <PaletteShell label="Find Usages" description="Ctrl+F7" onClose={onClose}>
      <section className="editor-query-panel" aria-label="Editor Query Panel">
        <div className="editor-query-panel__header">
          <div className="editor-query-panel__title">
            <strong>{getQueryTitle(state)}</strong>
            <span>{getQueryMeta(state)}</span>
          </div>
        </div>
        <div className="editor-query-panel__body">
          <UsagesPanel state={state} onOpenUsage={onOpenUsage} />
        </div>
      </section>
    </PaletteShell>
  );
}
