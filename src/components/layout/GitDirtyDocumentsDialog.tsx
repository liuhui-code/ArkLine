import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GitWorkingTreeGuardController } from "@/components/layout/use-git-working-tree-guard";
import { getPathBasename } from "@/features/workspace/workspace-store";

export function GitDirtyDocumentsDialog({ guard }: { guard: GitWorkingTreeGuardController }) {
  const { pending, saving } = guard;
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending || saving) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") guard.cancel();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [guard, pending, saving]);

  useEffect(() => {
    if (pending && !saving) primaryActionRef.current?.focus();
  }, [pending, saving]);

  if (!pending) return null;
  return (
    <div
      className="git-dirty-documents__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) guard.cancel();
      }}
    >
      <section className="git-dirty-documents" role="dialog" aria-modal="true" aria-labelledby="git-dirty-documents-title" onKeyDown={trapDialogFocus}>
        <header>
          <div>
            <h2 id="git-dirty-documents-title">Save files before Git changes them?</h2>
            <span>{pending.actionLabel}</span>
          </div>
          <button type="button" aria-label="Cancel Git operation" disabled={saving} onClick={guard.cancel}>×</button>
        </header>
        <div className="git-dirty-documents__body">
          <p>The operation is paused because these editor changes are not saved to disk.</p>
          <ul aria-label="Unsaved files">
            {pending.dirtyPaths.map((path) => (
              <li key={path} title={path}>
                <strong>{getPathBasename(path)}</strong>
                <span>{path}</span>
              </li>
            ))}
          </ul>
          {guard.error ? <p className="git-dirty-documents__error" role="alert">Could not save: {guard.error}</p> : null}
        </div>
        <footer>
          <button type="button" disabled={saving} onClick={guard.cancel}>Cancel</button>
          <button ref={primaryActionRef} type="button" className="git-dirty-documents__primary" disabled={saving} onClick={() => void guard.saveAndContinue()}>
            {saving ? "Saving..." : "Save All and Continue"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  if (controls.length < 2) return;
  const index = controls.indexOf(document.activeElement as HTMLButtonElement);
  const target = event.shiftKey && index <= 0
    ? controls[controls.length - 1]
    : !event.shiftKey && (index < 0 || index === controls.length - 1) ? controls[0] : null;
  if (!target) return;
  event.preventDefault();
  target.focus();
}
