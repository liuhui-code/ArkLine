import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { GitSideBySideDiff } from "@/components/layout/GitSideBySideDiff";
import { buildPartialPatchBody, changedLineIndexes } from "@/features/diff/partial-patch";
import type { DiffFile, DiffHunk, DiffLine } from "@/features/diff/unified-diff";
import type { GitDiffActionContext, GitFileComparison, GitPatchAction } from "@/features/git/git-source-control-model";

const GitFullFileDiff = lazy(() => import("@/components/layout/GitFullFileDiff").then((module) => ({ default: module.GitFullFileDiff })));

type GitDiffViewerProps = {
  file: DiffFile;
  comparison?: GitFileComparison | null;
  actionContext: GitDiffActionContext | null;
  onApplyPartial?: (action: GitPatchAction, patch: string, context: GitDiffActionContext) => Promise<void>;
};

export function GitDiffViewer({ file, comparison = null, actionContext, onApplyPartial }: GitDiffViewerProps) {
  const fullFileReady = Boolean(comparison && !comparison.before.binary && !comparison.after.binary && !comparison.before.truncated && !comparison.after.truncated);
  const [mode, setMode] = useState<"full" | "split" | "unified">(() => fullFileReady ? "full" : "split");
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [applying, setApplying] = useState<GitPatchAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeHunk, setActiveHunk] = useState(0);
  const hunkRefs = useRef<Array<HTMLDivElement | null>>([]);
  const actionable = Boolean(
    actionContext
    && actionContext.relativePath === file.path
    && !["untracked", "conflicted", "renamed"].includes(actionContext.kind)
    && !file.binary
    && onApplyPartial,
  );

  useEffect(() => {
    setSelected({});
    setError(null);
    setActiveHunk(0);
    setMode(fullFileReady ? "full" : "split");
  }, [actionContext, file, fullFileReady]);

  const selectedCount = useMemo(
    () => Object.values(selected).reduce((total, indexes) => total + indexes.length, 0),
    [selected],
  );

  const apply = async (action: GitPatchAction, selections: Array<{ hunk: DiffHunk; indexes: number[] }>) => {
    if (!actionContext || !onApplyPartial || applying) return;
    const direction = action === "stage" ? "forward" : "reverse";
    try {
      setApplying(action);
      setError(null);
      const patch = selections
        .map(({ hunk, indexes }) => buildPartialPatchBody(hunk, new Set(indexes), direction))
        .join("");
      await onApplyPartial(action, patch, actionContext);
      setSelected({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setApplying(null);
    }
  };

  const applySelected = (action: GitPatchAction) => {
    const selections = file.hunks.flatMap((hunk, index) => {
      const indexes = selected[hunkKey(hunk, index)] ?? [];
      return indexes.length ? [{ hunk, indexes }] : [];
    });
    return apply(action, selections);
  };

  const navigateHunk = (delta: number) => {
    if (!file.hunks.length) return;
    const next = Math.max(0, Math.min(file.hunks.length - 1, activeHunk + delta));
    setActiveHunk(next);
    hunkRefs.current[next]?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  if (file.binary) return <p>Binary change</p>;

  return (
    <div
      className={`diff-review diff-review--${mode}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "F7") return;
        event.preventDefault();
        navigateHunk(event.shiftKey ? -1 : 1);
      }}
    >
      <div className="diff-review__toolbar" role="toolbar" aria-label="Diff viewer controls">
        <div className="diff-review__mode" role="group" aria-label="Diff layout">
          {fullFileReady ? <button type="button" aria-pressed={mode === "full"} onClick={() => setMode("full")}>Full File</button> : null}
          <button type="button" aria-pressed={mode === "split"} onClick={() => setMode("split")}>Side-by-side</button>
          <button type="button" aria-pressed={mode === "unified"} onClick={() => setMode("unified")}>Unified</button>
        </div>
        <div className="diff-review__navigation">
          <button type="button" aria-label="Previous difference" title="Previous difference (Shift+F7)" disabled={activeHunk <= 0} onClick={() => navigateHunk(-1)}>↑</button>
          <span>{file.hunks.length ? `${activeHunk + 1} / ${file.hunks.length}` : "No differences"}</span>
          <button type="button" aria-label="Next difference" title="Next difference (F7)" disabled={activeHunk >= file.hunks.length - 1} onClick={() => navigateHunk(1)}>↓</button>
        </div>
      </div>
      {actionable && selectedCount > 0 ? (
        <div className="diff-review__selection-actions" role="toolbar" aria-label="Selected line actions">
          <strong>{selectedCount} selected</strong>
          <button type="button" disabled={Boolean(applying)} onClick={() => void applySelected(actionContext!.staged ? "unstage" : "stage")}>
            {applying ?? (actionContext!.staged ? "Unstage Selected" : "Stage Selected")}
          </button>
          {!actionContext!.staged ? <button type="button" className="diff-review__discard" disabled={Boolean(applying)} onClick={() => void applySelected("discard")}>Discard Selected</button> : null}
        </div>
      ) : null}
      {error ? <div className="diff-review__error" role="alert">{error}</div> : null}
      {mode === "full" && comparison ? (
        <Suspense fallback={<div className="git-full-diff__loading">Preparing full file comparison...</div>}>
          <GitFullFileDiff comparison={comparison} activeDifference={activeHunk} />
        </Suspense>
      ) : <div className="diff-list" aria-label="Diff Files">
        {file.hunks.map((hunk, hunkIndex) => {
          const key = hunkKey(hunk, hunkIndex);
          const changed = changedLineIndexes(hunk);
          return (
            <div key={key} ref={(node) => { hunkRefs.current[hunkIndex] = node; }} className={`diff-hunk${activeHunk === hunkIndex ? " diff-hunk--active" : ""}`}>
              <div className="diff-hunk__header">
                <code>{hunk.header}</code>
                {actionable ? (
                  <div className="diff-hunk__actions">
                    <button type="button" disabled={Boolean(applying)} onClick={() => void apply(actionContext!.staged ? "unstage" : "stage", [{ hunk, indexes: changed }])}>
                      {actionContext!.staged ? "Unstage Hunk" : "Stage Hunk"}
                    </button>
                    {!actionContext!.staged ? <button type="button" className="diff-review__discard" disabled={Boolean(applying)} onClick={() => void apply("discard", [{ hunk, indexes: changed }])}>Discard Hunk</button> : null}
                  </div>
                ) : null}
              </div>
              {mode === "split" ? (
                <GitSideBySideDiff
                  hunk={hunk}
                  selectedIndexes={selected[key] ?? []}
                  selectable={actionable}
                  onToggle={(lineIndex) => setSelected((current) => toggleLine(current, key, lineIndex))}
                />
              ) : hunk.lines.map((line, lineIndex) => (
                  <DiffRow
                    key={`${key}:${lineIndex}`}
                    line={line}
                    checked={(selected[key] ?? []).includes(lineIndex)}
                    selectable={actionable && line.kind !== "context"}
                    onToggle={() => setSelected((current) => toggleLine(current, key, lineIndex))}
                  />
                ))}
            </div>
          );
        })}
      </div>}
    </div>
  );
}

function DiffRow({ line, checked, selectable, onToggle }: {
  line: DiffLine;
  checked: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`diff-line diff-line--${line.kind}${checked ? " diff-line--selected" : ""}`}>
      <span className="diff-line__select">
        {selectable ? <input type="checkbox" aria-label={`Select ${line.kind} line ${line.newLine ?? line.oldLine}`} checked={checked} onChange={onToggle} /> : null}
      </span>
      <span className="diff-line__number">{line.oldLine ?? ""}</span>
      <span className="diff-line__number">{line.newLine ?? ""}</span>
      <code className="diff-line__code">{`${renderDiffPrefix(line.kind)} ${line.text}`}</code>
    </div>
  );
}

function toggleLine(current: Record<string, number[]>, key: string, lineIndex: number) {
  const indexes = current[key] ?? [];
  const next = indexes.includes(lineIndex)
    ? indexes.filter((index) => index !== lineIndex)
    : [...indexes, lineIndex].sort((left, right) => left - right);
  return { ...current, [key]: next };
}

function hunkKey(hunk: DiffHunk, index: number) {
  return `${index}:${hunk.header}`;
}

function renderDiffPrefix(kind: DiffLine["kind"]) {
  return kind === "added" ? "+" : kind === "removed" ? "-" : " ";
}
