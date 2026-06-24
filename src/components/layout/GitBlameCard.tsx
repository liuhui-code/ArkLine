import type { GitBlameAttribution } from "@/features/git/git-trace-model";

type GitBlameCardProps = {
  attribution: GitBlameAttribution;
  onClose: () => void;
  onShowDiff: () => void;
  onCopyHash: () => void;
};

export function GitBlameCard({ attribution, onClose, onShowDiff, onCopyHash }: GitBlameCardProps) {
  const isLocal = attribution.status === "added" || attribution.status === "modified";
  const title = isLocal ? "Local uncommitted change" : attribution.summary ?? "Git blame details";
  const author = attribution.author ?? attribution.originalAuthor ?? "Uncommitted";
  const time = attribution.relativeTime ?? "Working tree";

  return (
    <aside role="dialog" aria-label="Git Blame Details" className="git-blame-card">
      <div className="git-blame-card__header">
        <strong>{title}</strong>
        <button type="button" aria-label="Close Git Blame Details" onClick={onClose}>x</button>
      </div>
      <div className="git-blame-card__meta">
        <span>{author}</span>
        <span>{time}</span>
        {attribution.shortCommit ? <code>{attribution.shortCommit}</code> : null}
      </div>
      <div className="git-blame-card__actions">
        <button type="button" onClick={onShowDiff}>Show Diff</button>
        <button type="button" onClick={onCopyHash} disabled={!attribution.commit}>Copy Hash</button>
      </div>
    </aside>
  );
}
