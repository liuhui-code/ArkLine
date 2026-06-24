import type { GitTraceState } from "@/features/git/git-trace-model";

type GitTracePanelProps = {
  state: GitTraceState;
  onOpenCommitDiff: (patch: string) => void;
  onOpenInEditor: () => void;
};

export function GitTracePanel({ state, onOpenCommitDiff, onOpenInEditor }: GitTracePanelProps) {
  if (state.blameStatus === "idle" || state.blameStatus === "loading") {
    return <section aria-label="Git Trace Panel" className="bottom-tool-window__panel">Loading line history...</section>;
  }

  if (state.blameStatus === "unavailable" || state.blameStatus === "error") {
    return <section aria-label="Git Trace Panel" className="bottom-tool-window__panel">{state.message ?? "Git Trace unavailable"}</section>;
  }

  if (state.detailStatus === "loading") {
    return <section aria-label="Git Trace Panel" className="bottom-tool-window__panel">Loading commit details...</section>;
  }

  if (!state.detail || state.detailStatus === "unavailable" || state.detailStatus === "error") {
    return <section aria-label="Git Trace Panel" className="bottom-tool-window__panel">{state.message ?? "Commit details unavailable"}</section>;
  }

  return (
    <section aria-label="Git Trace Panel" className="bottom-tool-window__panel bottom-tool-window__panel--git-trace">
      <div className="git-trace-panel">
        <section className="git-trace-panel__section">
          <h3>Commit</h3>
          <div className="git-trace-panel__header">
            <div className="git-trace-panel__meta">
              <strong>{state.detail.subject}</strong>
              <span className="git-trace-panel__hash">{state.detail.shortCommit}</span>
            </div>
          </div>
          <div className="git-trace-panel__summary">
            <div><strong>Author</strong> {state.detail.author}</div>
            <div><strong>Date</strong> {state.detail.authoredAt}</div>
            <div><strong>File</strong> {state.detail.relativePath}</div>
            <div><strong>Line</strong> {state.detail.selectedLine}</div>
          </div>
        </section>
        <section className="git-trace-panel__section">
          <h3>Actions</h3>
          <div className="git-trace-panel__actions">
            <button type="button" className="git-tool-window__viewer-action" onClick={onOpenInEditor}>
              Open in Editor
            </button>
            <button type="button" className="git-tool-window__viewer-action" onClick={() => onOpenCommitDiff(state.detail!.patch)}>
              Open Commit Diff
            </button>
          </div>
        </section>
        <section className="git-trace-panel__section git-trace-panel__section--diff">
          <h3>Diff Preview</h3>
          <pre className="git-trace-panel__patch">{state.detail.patch}</pre>
        </section>
      </div>
    </section>
  );
}
