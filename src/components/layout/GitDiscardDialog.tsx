import { useEffect } from "react";
import { getPathBasename } from "@/features/workspace/workspace-store";
import type { SourceControlDiscardController } from "@/components/layout/use-source-control-controller";

export function GitDiscardDialog({ discard }: { discard: SourceControlDiscardController }) {
  const entry = discard.pending;

  useEffect(() => {
    if (!entry || discard.discarding) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") discard.cancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [discard, entry]);

  if (!entry) return null;
  const label = entry.kind === "untracked" ? "Delete Unversioned File" : "Rollback Changes";
  return (
    <div
      className="git-discard-dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !discard.discarding) discard.cancel();
      }}
    >
      <section className="git-discard-dialog" role="dialog" aria-modal="true" aria-labelledby="git-discard-title">
        <header>
          <div>
            <h2 id="git-discard-title">{label}</h2>
            <span>{entry.relativePath}</span>
          </div>
          <button type="button" aria-label="Close discard confirmation" disabled={discard.discarding} onClick={discard.cancel}>×</button>
        </header>
        <div className="git-discard-dialog__body">
          <strong>{getPathBasename(entry.relativePath)}</strong>
          <p>{entry.kind === "untracked"
            ? "The unversioned file will be deleted from the working tree."
            : "Local edits will be rolled back to the current index version."}</p>
          <p>ArkLine creates a protected Git safety commit first, so this action can be undone from Source Control.</p>
        </div>
        <footer>
          <button type="button" disabled={discard.discarding} onClick={discard.cancel}>Cancel</button>
          <button type="button" className="git-discard-dialog__danger" disabled={discard.discarding} onClick={() => void discard.confirm()}>
            {discard.discarding ? "Applying..." : entry.kind === "untracked" ? "Delete File" : "Rollback"}
          </button>
        </footer>
      </section>
    </div>
  );
}
