import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { GitConflictResolution, GitConflictVersion } from "@/features/git/git-source-control-model";
import {
  countConflictMarkers,
  findConflictMarkerBlocks,
  resolveConflictMarker,
  type GitConflictMarkerChoice,
} from "@/features/git/git-conflict-markers";
import type { SourceControlConflictController } from "@/components/layout/use-source-control-controller";

const GitConflictCodeEditor = lazy(() => import("@/components/layout/GitConflictCodeEditor").then((module) => ({ default: module.GitConflictCodeEditor })));

type GitConflictResolverProps = {
  conflict: SourceControlConflictController;
};

export function GitConflictResolver({ conflict }: GitConflictResolverProps) {
  const [result, setResult] = useState("");
  const [resolution, setResolution] = useState<GitConflictResolution>("content");
  const [showBase, setShowBase] = useState(false);
  const [activeConflict, setActiveConflict] = useState(0);

  useEffect(() => {
    const content = conflict.content;
    if (!content) return;
    setResult(content.result ?? content.current.content ?? content.incoming.content ?? "");
    setResolution(content.binary ? preferredBinaryResolution(content.current, content.incoming) : "content");
    setShowBase(false);
    setActiveConflict(0);
  }, [conflict.content]);

  useEffect(() => {
    if (!conflict.path || conflict.saving) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") conflict.close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [conflict.close, conflict.path, conflict.saving]);

  const content = conflict.content;
  const unresolvedMarkers = content && !content.binary && resolution === "content" ? countConflictMarkers(result) : 0;
  const markerBlocks = useMemo(
    () => content && !content.binary && resolution === "content" ? findConflictMarkerBlocks(result) : [],
    [content, resolution, result],
  );
  const activeMarkerIndex = Math.min(activeConflict, Math.max(0, markerBlocks.length - 1));

  useEffect(() => {
    if (activeConflict !== activeMarkerIndex) setActiveConflict(activeMarkerIndex);
  }, [activeConflict, activeMarkerIndex]);

  if (!conflict.path) return null;

  function useVersion(version: GitConflictVersion, selected: "current" | "incoming") {
    if (!version.exists) {
      setResult("");
      setResolution("delete");
    } else if (version.binary) {
      setResult("");
      setResolution(selected);
    } else {
      setResult(version.content ?? "");
      setResolution("content");
    }
  }

  function useBoth() {
    if (!content) return;
    const current = content.current.content ?? "";
    const incoming = content.incoming.content ?? "";
    setResult(`${current}${current && incoming && !current.endsWith("\n") ? "\n" : ""}${incoming}`);
    setResolution("content");
  }

  function resolveActiveMarker(choice: GitConflictMarkerChoice) {
    const block = markerBlocks[activeMarkerIndex];
    if (!block) return;
    setResult(resolveConflictMarker(result, block, choice));
    setResolution("content");
  }

  function navigateConflict(delta: number) {
    if (!markerBlocks.length) return;
    setActiveConflict((current) => Math.max(0, Math.min(markerBlocks.length - 1, current + delta)));
  }

  return (
    <div className="git-conflict-resolver__overlay" role="presentation" onMouseDown={() => conflict.close()}>
      <section
        className="git-conflict-resolver"
        role="dialog"
        aria-modal="true"
        aria-label={`Resolve conflict: ${conflict.path}`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "F7" || !markerBlocks.length) return;
          event.preventDefault();
          navigateConflict(event.shiftKey ? -1 : 1);
        }}
      >
        <header className="git-conflict-resolver__header">
          <div><span>Resolve Conflict</span><strong>{conflict.path}</strong></div>
          <button type="button" className="git-conflict-resolver__base-toggle" aria-pressed={showBase} disabled={!content || conflict.saving} onClick={() => setShowBase((visible) => !visible)}>{showBase ? "Hide Base" : "Show Base"}</button>
          <button type="button" aria-label="Close conflict resolver" disabled={conflict.saving} onClick={conflict.close}>×</button>
        </header>
        {conflict.loading ? <div className="git-conflict-resolver__loading">Loading conflict versions...</div> : null}
        {conflict.error ? <div className="git-conflict-resolver__error" role="alert">{conflict.error}</div> : null}
        {content ? (
          <Suspense fallback={<div className="git-conflict-resolver__loading">Preparing merge editors...</div>}>
            <div className="git-conflict-resolver__body">
              <div className="git-conflict-resolver__workspace">
              <ConflictVersion
                title="Current"
                detail="Your branch"
                version={content.current}
                original={baseText(content)}
                relativePath={content.relativePath}
                actionLabel={content.current.exists ? "Accept Current" : "Accept Deletion"}
                disabled={conflict.saving}
                onAccept={() => useVersion(content.current, "current")}
              />
              <ResultPane
                value={result}
                binary={content.binary}
                deleted={resolution === "delete"}
                disabled={conflict.saving}
                unresolvedMarkers={unresolvedMarkers}
                markerBlocks={markerBlocks}
                activeMarkerIndex={activeMarkerIndex}
                original={baseText(content)}
                relativePath={content.relativePath}
                onChange={(value) => { setResult(value); setResolution("content"); }}
                onUseBoth={useBoth}
                onNavigateMarker={setActiveConflict}
                onResolveMarker={resolveActiveMarker}
              />
              <ConflictVersion
                title="Incoming"
                detail="Merged branch"
                version={content.incoming}
                original={baseText(content)}
                relativePath={content.relativePath}
                actionLabel={content.incoming.exists ? "Accept Incoming" : "Accept Deletion"}
                disabled={conflict.saving}
                onAccept={() => useVersion(content.incoming, "incoming")}
              />
              </div>
              {showBase ? <ConflictVersion title="Base" detail="Common ancestor" version={content.base} original={null} relativePath={content.relativePath} /> : null}
            </div>
          </Suspense>
        ) : null}
        <footer className="git-conflict-resolver__footer">
          <button type="button" disabled={conflict.saving} onClick={conflict.close}>Cancel</button>
          {content ? <button type="button" className="git-conflict-resolver__delete" disabled={conflict.saving} onClick={() => { setResult(""); setResolution("delete"); }}>Delete File</button> : null}
          {content ? <span className={`git-conflict-resolver__resolution-status${unresolvedMarkers ? " git-conflict-resolver__resolution-status--blocked" : ""}`}>{unresolvedMarkers ? `${unresolvedMarkers} unresolved conflict${unresolvedMarkers === 1 ? "" : "s"}` : "Ready to mark resolved"}</span> : null}
          <button
            type="button"
            className="git-conflict-resolver__apply"
            disabled={!content || conflict.loading || conflict.saving || unresolvedMarkers > 0}
            onClick={() => void conflict.resolve(resolution, resolution === "content" ? result : null)}
          >
            {conflict.saving ? "Applying..." : "Save & Mark Resolved"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ConflictVersion({ title, detail, version, original, relativePath, actionLabel, disabled, onAccept }: {
  title: string;
  detail: string;
  version: GitConflictVersion;
  original: string | null;
  relativePath: string;
  actionLabel?: string;
  disabled?: boolean;
  onAccept?: () => void;
}) {
  return (
    <section className="git-conflict-resolver__version" aria-label={title}>
      <header><div><strong>{title}</strong><span>{detail}</span></div>{onAccept ? <button type="button" disabled={disabled} onClick={onAccept}>{actionLabel}</button> : null}</header>
      <VersionContent ariaLabel={`${title} conflict version`} version={version} original={original} relativePath={relativePath} />
    </section>
  );
}

function VersionContent({ ariaLabel, version, original, relativePath }: {
  ariaLabel: string;
  version: GitConflictVersion;
  original: string | null;
  relativePath: string;
}) {
  if (!version.exists) return <div className="git-conflict-resolver__unavailable">File does not exist in this version.</div>;
  if (version.binary) return <div className="git-conflict-resolver__unavailable">Binary content</div>;
  return <GitConflictCodeEditor ariaLabel={ariaLabel} value={version.content ?? ""} original={original} relativePath={relativePath} readOnly />;
}

function ResultPane({ value, binary, deleted, disabled, unresolvedMarkers, markerBlocks, activeMarkerIndex, original, relativePath, onChange, onUseBoth, onNavigateMarker, onResolveMarker }: {
  value: string;
  binary: boolean;
  deleted: boolean;
  disabled: boolean;
  unresolvedMarkers: number;
  markerBlocks: ReturnType<typeof findConflictMarkerBlocks>;
  activeMarkerIndex: number;
  original: string | null;
  relativePath: string;
  onChange: (value: string) => void;
  onUseBoth: () => void;
  onNavigateMarker: (index: number) => void;
  onResolveMarker: (choice: GitConflictMarkerChoice) => void;
}) {
  const activeBlock = markerBlocks[activeMarkerIndex];

  return (
    <section className={`git-conflict-resolver__version git-conflict-resolver__version--result${markerBlocks.length ? " git-conflict-resolver__version--has-markers" : ""}`} aria-label="Result">
      <header>
        <div><strong>Result</strong><span>{unresolvedMarkers ? `${unresolvedMarkers} unresolved` : "Merged output"}</span></div>
        <button type="button" disabled={disabled || binary} onClick={onUseBoth}>Accept Both</button>
      </header>
      {markerBlocks.length ? (
        <div className="git-conflict-resolver__marker-actions" role="toolbar" aria-label="Conflict navigation">
          <button type="button" aria-label="Previous conflict" disabled={disabled || activeMarkerIndex === 0} onClick={() => onNavigateMarker(activeMarkerIndex - 1)}>↑</button>
          <span>Conflict {activeMarkerIndex + 1} / {markerBlocks.length}</span>
          <button type="button" aria-label="Next conflict" disabled={disabled || activeMarkerIndex >= markerBlocks.length - 1} onClick={() => onNavigateMarker(activeMarkerIndex + 1)}>↓</button>
          <button type="button" disabled={disabled} onClick={() => onResolveMarker("current")}>Accept Current Conflict</button>
          <button type="button" disabled={disabled} onClick={() => onResolveMarker("both")}>Accept Both for Conflict</button>
          <button type="button" disabled={disabled} onClick={() => onResolveMarker("incoming")}>Accept Incoming Conflict</button>
        </div>
      ) : null}
      {binary ? <div className="git-conflict-resolver__unavailable">Binary conflict: accept Current, Incoming, or deletion.</div>
        : deleted ? <div className="git-conflict-resolver__unavailable">File will be deleted.</div>
          : <GitConflictCodeEditor ariaLabel="Resolved content" value={value} original={original} relativePath={relativePath} readOnly={disabled} activeOffset={activeBlock?.start ?? null} onChange={onChange} />}
    </section>
  );
}

function baseText(content: { base: GitConflictVersion }) {
  return content.base.exists && !content.base.binary ? content.base.content ?? "" : null;
}

function preferredBinaryResolution(current: GitConflictVersion, incoming: GitConflictVersion): GitConflictResolution {
  if (current.exists) return "current";
  if (incoming.exists) return "incoming";
  return "delete";
}
