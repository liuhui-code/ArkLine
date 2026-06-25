import { useEffect, useState, type ReactNode } from "react";
import type { DiffFile } from "@/features/diff/unified-diff";

export type GitToolView = "changes" | "trace";

type GitToolWindowProps = {
  files: DiffFile[];
  activeView: GitToolView;
  tracePanel: ReactNode;
  onChangeView: (view: GitToolView) => void;
  onOpenFile: (path: string) => void;
};

function getFileStatus(file: DiffFile) {
  const hasAdded = file.hunks.some((hunk) => hunk.lines.some((line) => line.kind === "added"));
  const hasRemoved = file.hunks.some((hunk) => hunk.lines.some((line) => line.kind === "removed"));
  if (file.binary) {
    return { short: "B", label: "Binary" };
  }
  if (hasAdded && hasRemoved) {
    return { short: "M", label: "Modified" };
  }
  if (hasAdded) {
    return { short: "A", label: "Added" };
  }
  if (hasRemoved) {
    return { short: "D", label: "Deleted" };
  }
  return { short: "M", label: "Modified" };
}

function renderDiffPrefix(kind: "context" | "added" | "removed") {
  if (kind === "added") {
    return "+";
  }
  if (kind === "removed") {
    return "-";
  }
  return " ";
}

export function GitToolWindow({ files, activeView, tracePanel, onChangeView, onOpenFile }: GitToolWindowProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(files[0]?.path ?? null);

  useEffect(() => {
    setSelectedPath((current) => {
      if (current && files.some((file) => file.path === current)) {
        return current;
      }

      return files[0]?.path ?? null;
    });
  }, [files]);

  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  return (
    <section aria-label="Git Panel" className="bottom-tool-window__panel bottom-tool-window__panel--git">
      <div className="git-tool-window__tabs" role="tablist" aria-label="Git Views">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "changes"}
          className={`git-tool-window__tab${activeView === "changes" ? " git-tool-window__tab--active" : ""}`}
          onClick={() => onChangeView("changes")}
        >
          Local Changes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "trace"}
          className={`git-tool-window__tab${activeView === "trace" ? " git-tool-window__tab--active" : ""}`}
          onClick={() => onChangeView("trace")}
        >
          Line Trace
        </button>
      </div>
      {activeView === "trace" ? (
        <div className="git-tool-window__trace" role="tabpanel" aria-label="Line Trace View">
          {tracePanel}
        </div>
      ) : files.length > 0 ? (
        <div className="git-tool-window">
          <div className="git-tool-window__sidebar">
            <strong className="git-tool-window__heading">Local Changes</strong>
            <div className="git-tool-window__file-list" role="list" aria-label="Changed Files">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`git-tool-window__file${selectedFile?.path === file.path ? " git-tool-window__file--active" : ""}`}
                  onClick={() => setSelectedPath(file.path)}
                >
                  <span className="git-tool-window__file-path">{file.path}</span>
                  <span className={`git-tool-window__file-status git-tool-window__file-status--${getFileStatus(file).short.toLowerCase()}`}>
                    {getFileStatus(file).short}
                  </span>
                  <span className="visually-hidden">{getFileStatus(file).label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="git-tool-window__viewer" aria-label="Git Diff Viewer">
            {selectedFile ? (
              <>
                <div className="git-tool-window__viewer-header">
                  <div className="git-tool-window__viewer-meta">
                    <strong>{selectedFile.path}</strong>
                    <span className="git-tool-window__viewer-status">{getFileStatus(selectedFile).label}</span>
                  </div>
                  <button type="button" className="git-tool-window__viewer-action" onClick={() => onOpenFile(selectedFile.path)}>
                    Open in Editor
                  </button>
                </div>
                {selectedFile.binary ? (
                  <p>Binary change</p>
                ) : (
                  <div className="diff-list" aria-label="Diff Files">
                    {selectedFile.hunks.map((hunk) => (
                      <div key={`${selectedFile.path}:${hunk.header}`} className="diff-hunk">
                        <code>{hunk.header}</code>
                        {hunk.lines.map((line, index) => (
                          <div key={`${selectedFile.path}:${hunk.header}:${index}`} className={`diff-line diff-line--${line.kind}`}>
                            <span className="diff-line__number">{index + 1}</span>
                            <code className="diff-line__code">{`${renderDiffPrefix(line.kind)} ${line.text}`}</code>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p>Git and imported patch review will appear here.</p>
            )}
          </div>
        </div>
      ) : (
        <p>Git and imported patch review will appear here.</p>
      )}
    </section>
  );
}
