import { useEffect, useRef, useState } from "react";
import type { GitPushController } from "@/components/layout/use-git-push-controller";

export function GitPushDialog({ push }: { push: GitPushController }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const commitListRef = useRef<HTMLDivElement>(null);
  const [confirmForce, setConfirmForce] = useState(false);
  useEffect(() => {
    if (push.visible) closeRef.current?.focus();
  }, [push.visible]);
  useEffect(() => {
    if (push.visible && push.preview?.commits.length) commitListRef.current?.focus();
  }, [push.preview?.commits.length, push.visible]);
  if (!push.visible) return null;
  const preview = push.preview;
  const commitCount = preview?.totalCommits ?? 0;
  const canPush = Boolean(preview && (!preview.hasUpstream || commitCount > 0));
  return (
    <div className="git-push-dialog__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) push.close(); }}>
      <section className="git-push-dialog" role="dialog" aria-modal="true" aria-labelledby="git-push-title" onKeyDown={(event) => { if (event.key === "Escape") push.close(); }}>
        <header className="git-push-dialog__header">
          <div><h2 id="git-push-title">Push Commits</h2><span>Review outgoing commits before updating the remote</span></div>
          <button ref={closeRef} type="button" aria-label="Close Push Commits" disabled={push.pushing} onClick={push.close}>×</button>
        </header>
        {preview ? (
          <div className="git-push-dialog__target">
            <span className="git-push-dialog__repo">{repoName(preview.repositoryRoot)}</span>
            <code>{preview.localBranch}</code><span aria-hidden="true">→</span><code>{preview.remote}/{preview.remoteBranch}</code>
            <strong>{preview.hasUpstream ? `${commitCount} outgoing` : "new branch"}</strong>
          </div>
        ) : null}
        {push.error ? <div className="git-push-dialog__error" role="alert">{push.error}</div> : null}
        <div className="git-push-dialog__body" aria-busy={push.loading}>
          <div ref={commitListRef} className="git-push-dialog__commits" role="listbox" aria-label="Outgoing commits" tabIndex={0} onKeyDown={(event) => {
            const commits = push.preview?.commits ?? [];
            const index = commits.findIndex((commit) => commit.commit === push.selectedCommit);
            const next = event.key === "ArrowDown" ? Math.min(commits.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : -1;
            if (next >= 0 && commits[next]) { event.preventDefault(); void push.selectCommit(commits[next]); }
          }}>
            {push.loading ? <p>Loading outgoing commits…</p> : null}
            {!push.loading && preview?.hasUpstream && commitCount === 0 ? <EmptyPush /> : null}
            {preview?.commitsTruncated ? <p className="git-push-dialog__notice">Showing the first {preview.commits.length} of {preview.totalCommits} outgoing commits. Push still updates the complete branch.</p> : null}
            {preview?.commits.map((commit) => (
              <button key={commit.commit} type="button" role="option" aria-selected={push.selectedCommit === commit.commit} onClick={() => void push.selectCommit(commit)}>
                <span className="git-push-dialog__graph" aria-hidden="true">●</span>
                <span><strong>{commit.subject}</strong><small>{commit.author} · {relativeTime(commit.authoredAtEpochSeconds)}</small></span>
                <code>{commit.shortCommit}</code>
              </button>
            ))}
          </div>
          <aside className="git-push-dialog__details" aria-label="Selected outgoing commit">
            {push.details ? <><h3>{push.details.subject}</h3><p>{push.details.body}</p><strong>Changed Files · {push.details.files.length}</strong><div role="list">{push.details.files.map((file) => <div role="listitem" key={`${file.status}:${file.path}`}><span>{file.status}</span><span>{file.path}</span></div>)}</div></> : <p>Select a commit to inspect its changed files.</p>}
          </aside>
        </div>
        <footer className="git-push-dialog__footer">
          <span>{confirmForce ? "Force push is protected by --force-with-lease; confirm the remote rewrite." : preview?.hasUpstream ? "Pushes the complete outgoing commit chain" : "Publishes this branch and sets its upstream"}</span>
          <div>{push.recoveryNeeded ? <><button type="button" disabled={push.pushing} onClick={() => void push.updateAndPush("rebase")}>Update with Rebase</button><button type="button" disabled={push.pushing} onClick={() => void push.updateAndPush("merge")}>Update with Merge</button>{confirmForce ? <button type="button" className="git-stash-dialog__danger" disabled={push.pushing} onClick={() => void push.forcePush()}>Confirm Force Push</button> : <button type="button" disabled={push.pushing} onClick={() => setConfirmForce(true)}>Force Push…</button>}</> : null}<button type="button" disabled={push.pushing} onClick={push.close}>Cancel</button><button type="button" disabled={!canPush || push.pushing} className="git-push-dialog__primary" onClick={() => void push.push()}>{push.pushing ? "Pushing…" : preview?.hasUpstream ? `Push ${commitCount} Commit${commitCount === 1 ? "" : "s"}` : "Publish Branch"}</button></div>
        </footer>
      </section>
    </div>
  );
}

function EmptyPush() {
  return <div className="git-push-dialog__empty"><span aria-hidden="true">✓</span><strong>Everything is up to date</strong><p>There are no commits to push to the tracked branch.</p></div>;
}

function repoName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function relativeTime(epochSeconds: number) {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - epochSeconds) / 60));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
