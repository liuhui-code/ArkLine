import { useEffect, useState } from "react";
import { GitDiffViewer } from "@/components/layout/GitDiffViewer";
import type { DiffFile } from "@/features/diff/unified-diff";
import type { GitDiffActionContext, GitFileComparison, GitPatchAction } from "@/features/git/git-source-control-model";

type Props = {
  files: DiffFile[];
  comparison: GitFileComparison | null;
  actionContext: GitDiffActionContext | null;
  onApplyPartial: (action: GitPatchAction, patch: string, context: GitDiffActionContext) => Promise<void>;
  onOpenFile: (path: string) => void;
  onClose: () => void;
};

export function GitEditorDiffPreview({ files, comparison, actionContext, onApplyPartial, onOpenFile, onClose }: Props) {
  const [selectedPath, setSelectedPath] = useState(files[0]?.path ?? null);

  useEffect(() => {
    setSelectedPath((current) => files.some((file) => file.path === current) ? current : files[0]?.path ?? null);
  }, [files]);

  const selected = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  return (
    <section className="git-editor-diff" aria-label="Diff Preview">
      <header className="git-editor-diff__header">
        <div><strong>Diff Preview</strong><span>{files.length} changed file{files.length === 1 ? "" : "s"}</span></div>
        <div>{selected ? <button type="button" onClick={() => onOpenFile(selected.path)}>Open File</button> : null}<button type="button" aria-label="Close Diff Preview" onClick={onClose}>×</button></div>
      </header>
      <div className="git-editor-diff__body">
        <nav className="git-editor-diff__files" aria-label="Files in diff">
          {files.map((file) => <button key={file.path} type="button" aria-current={file.path === selected?.path ? "true" : undefined} onClick={() => setSelectedPath(file.path)}><Status file={file} /><span>{file.path}</span></button>)}
        </nav>
        <main className="git-editor-diff__viewer">
          {selected ? <><div className="git-editor-diff__path"><strong>{selected.path}</strong><span>{statusLabel(selected)}</span></div><GitDiffViewer file={selected} comparison={comparison?.relativePath === selected.path ? comparison : null} actionContext={actionContext} onApplyPartial={onApplyPartial} /></> : <p>No changes to preview.</p>}
        </main>
      </div>
    </section>
  );
}

function Status({ file }: { file: DiffFile }) {
  return <span className={`git-editor-diff__status git-editor-diff__status--${status(file).toLowerCase()}`} aria-label={statusLabel(file)}>{status(file)}</span>;
}

function status(file: DiffFile) {
  if (file.binary) return "B";
  const added = file.hunks.some((hunk) => hunk.lines.some((line) => line.kind === "added"));
  const removed = file.hunks.some((hunk) => hunk.lines.some((line) => line.kind === "removed"));
  return added && removed ? "M" : added ? "A" : removed ? "D" : "M";
}

function statusLabel(file: DiffFile) {
  return ({ A: "Added", B: "Binary", D: "Deleted", M: "Modified" } as const)[status(file)];
}
