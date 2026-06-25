import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { summarizeWorkspaceEditOperation } from "@/features/code-actions/workspace-edit-model";
import type { WorkspaceEditPreview as WorkspaceEditPreviewModel } from "@/features/workspace/workspace-api";

type WorkspaceEditPreviewProps = {
  preview: WorkspaceEditPreviewModel;
  applyState: "idle" | "applying" | "error";
  message?: string;
  onApply: () => void;
  onClose: () => void;
};

export function WorkspaceEditPreview({
  preview,
  applyState,
  message,
  onApply,
  onClose,
}: WorkspaceEditPreviewProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [selectedFile, setSelectedFile] = useState(preview.affectedFiles[0] ?? preview.plan.affectedFiles[0] ?? "");
  const applying = applyState === "applying";
  const conflicts = preview.conflicts.length > 0 ? preview.conflicts : preview.plan.conflicts;
  const canApply = !applying && conflicts.length === 0;
  const summary = useMemo(() => {
    if (preview.summary.length > 0) {
      return preview.summary;
    }

    return preview.plan.operations.map(summarizeWorkspaceEditOperation);
  }, [preview]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedFile(preview.affectedFiles[0] ?? preview.plan.affectedFiles[0] ?? "");
  }, [preview]);

  function requestClose() {
    if (!applying) {
      onClose();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    }
  }

  return (
    <section
      className="workspace-edit-preview"
      aria-label="Workspace Edit Preview Overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className="workspace-edit-preview__panel"
        role="dialog"
        aria-label="Workspace Edit Preview"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="workspace-edit-preview__header">
          <div>
            <h2>Workspace Edit Preview</h2>
            <span>{preview.plan.title}</span>
          </div>
          <button
            type="button"
            className="workspace-edit-preview__close"
            aria-label="Close Workspace Edit Preview"
            disabled={applying}
            onClick={requestClose}
          >
            ×
          </button>
        </header>

        <div className="workspace-edit-preview__body">
          <aside className="workspace-edit-preview__files" aria-label="Affected Files">
            <div className="workspace-edit-preview__section-label">Affected Files</div>
            {preview.affectedFiles.map((path) => (
              <button
                key={path}
                type="button"
                className={`workspace-edit-preview__file${path === selectedFile ? " workspace-edit-preview__file--selected" : ""}`}
                onClick={() => setSelectedFile(path)}
              >
                {path}
              </button>
            ))}
          </aside>

          <main className="workspace-edit-preview__details">
            <section className="workspace-edit-preview__card" aria-label="Operation Summary">
              <div className="workspace-edit-preview__section-label">Operation Summary</div>
              <ol className="workspace-edit-preview__summary">
                {summary.map((item, index) => (
                  <li key={`${index}:${item}`}>{item}</li>
                ))}
              </ol>
            </section>

            <section className="workspace-edit-preview__card" aria-label="Selected File Preview">
              <div className="workspace-edit-preview__section-label">Selected File</div>
              <div className="workspace-edit-preview__selected-file">{selectedFile || "No file selected"}</div>
            </section>

            {conflicts.length > 0 ? (
              <section className="workspace-edit-preview__conflicts" aria-label="Workspace Edit Conflicts">
                <div className="workspace-edit-preview__section-label">Conflicts</div>
                {conflicts.map((conflict) => (
                  <p key={`${conflict.path}:${conflict.message}`}>
                    <strong>{conflict.path}</strong>
                    <span>{conflict.message}</span>
                  </p>
                ))}
              </section>
            ) : null}

            {message ? <div className="workspace-edit-preview__message" role="status">{message}</div> : null}
          </main>
        </div>

        <footer className="workspace-edit-preview__footer">
          <button
            type="button"
            className="button button--secondary"
            aria-label="Cancel Workspace Edit"
            disabled={applying}
            onClick={requestClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            aria-label="Apply Workspace Edit"
            disabled={!canApply}
            onClick={onApply}
          >
            {applying ? "Applying..." : "Apply"}
          </button>
        </footer>
      </div>
    </section>
  );
}
