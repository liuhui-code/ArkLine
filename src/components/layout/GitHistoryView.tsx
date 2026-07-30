import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GitCommitFile, GitCommitSummary } from "@/features/git/git-history-model";
import type { GitHistoryController } from "@/components/layout/use-git-history-controller";

type GitHistoryViewProps = {
  history: GitHistoryController;
};

export function GitHistoryView({ history }: GitHistoryViewProps) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const commits = useMemo(() => filterCommits(history.commits, query), [history.commits, query]);

  useEffect(() => history.loadInitial(), [history.loadInitial]);
  useEffect(() => {
    if (!history.selectedCommit) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-commit="${history.selectedCommit}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [history.selectedCommit]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!commits.length) return;
    const currentIndex = commits.findIndex((commit) => commit.commit === history.selectedCommit);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(commits.length - 1, currentIndex + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = commits.length - 1;
    else if (event.key === "Enter" && history.selectedCommit) {
      event.preventDefault();
      void history.openCommitDiff();
      return;
    } else return;
    event.preventDefault();
    void history.selectCommit(commits[nextIndex]);
  }

  return (
    <div className={`git-history${history.selectedCommit ? " git-history--details-open" : ""}`}>
      <div className="git-history__toolbar">
        <input
          aria-label="Filter commit history"
          placeholder="Filter commits"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" aria-label="Refresh commit history" title="Refresh" disabled={history.status === "loading"} onClick={() => void history.refresh()}>↻</button>
      </div>
      {history.error ? <div className="source-control__error" role="alert">{history.error}</div> : null}
      <div
        ref={listRef}
        className="git-history__list"
        role="listbox"
        aria-label="Commit history"
        aria-busy={history.status === "loading"}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {history.status === "loading" ? <p className="source-control__empty">Loading history...</p> : null}
        {history.status === "ready" && commits.length === 0 ? <p className="source-control__empty">No matching commits</p> : null}
        {commits.map((commit) => (
          <CommitRow
            key={commit.commit}
            commit={commit}
            selected={commit.commit === history.selectedCommit}
            onSelect={() => void history.selectCommit(commit)}
          />
        ))}
        {history.hasMore && !query ? (
          <button type="button" className="git-history__load-more" disabled={history.loadingMore} onClick={history.loadMore}>
            {history.loadingMore ? "Loading..." : "Load More"}
          </button>
        ) : null}
      </div>
      <CommitDetails history={history} />
      <HistoryActionDialog history={history} />
    </div>
  );
}

function CommitRow({ commit, selected, onSelect }: { commit: GitCommitSummary; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-commit={commit.commit}
      className={`git-history__row${selected ? " git-history__row--selected" : ""}`}
      title={`${commit.shortCommit} ${commit.subject}`}
      onClick={onSelect}
    >
      <span className="git-history__graph" aria-hidden="true">{commit.graph || "*"}</span>
      <span className="git-history__row-content">
        <span className="git-history__subject">{commit.subject}</span>
        {commit.refs.length ? <span className="git-history__refs">{commit.refs.map((ref) => <span key={ref}>{ref}</span>)}</span> : null}
        <span className="git-history__meta"><span>{commit.author}</span><span>{relativeTime(commit.authoredAtEpochSeconds)}</span></span>
      </span>
    </button>
  );
}

function CommitDetails({ history }: GitHistoryViewProps) {
  if (!history.selectedCommit) return null;
  if (history.detailsLoading) return <div className="git-history__details git-history__details--empty">Loading commit...</div>;
  if (!history.details) return null;
  const actionBusy = history.actionStatus !== "idle";
  return (
    <section className="git-history__details" aria-label="Commit details">
      <header>
        <strong>{history.details.subject}</strong>
        <div className="git-history__details-actions">
          <button type="button" disabled={history.diffLoading || actionBusy} onClick={() => void history.openCommitDiff()}>{history.diffLoading ? "Opening..." : "Open Diff"}</button>
          <button type="button" disabled={actionBusy} onClick={() => history.requestCommitAction("cherryPick")}>Cherry-pick...</button>
          <button type="button" disabled={actionBusy} onClick={() => history.requestCommitAction("revert")}>Revert...</button>
          <button type="button" disabled={actionBusy} onClick={() => void history.copyCommitHash()}>Copy Hash</button>
        </div>
      </header>
      <div className="git-history__details-meta">
        <span>{history.details.author}</span>
        <code>{history.details.shortCommit}</code>
      </div>
      {history.details.body && history.details.body !== history.details.subject ? <p>{history.details.body}</p> : null}
      <CommitFileList history={history} />
    </section>
  );
}

function HistoryActionDialog({ history }: GitHistoryViewProps) {
  const action = history.pendingAction;
  if (!action || !history.details) return null;
  const label = action === "cherryPick" ? "Cherry-pick" : "Revert";
  const running = history.actionStatus !== "idle";
  return (
    <div className="git-stash-dialog__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !running) history.cancelCommitAction(); }}>
      <section className="git-stash-dialog" role="dialog" aria-modal="true" aria-labelledby="history-action-title">
        <header>
          <div><h2 id="history-action-title">{label} Commit</h2><span>{history.details.shortCommit}</span></div>
          <button type="button" aria-label="Close commit action" disabled={running} onClick={history.cancelCommitAction}>×</button>
        </header>
        <div className="git-stash-dialog__body">
          <strong>{history.details.subject}</strong>
          <p>{action === "cherryPick" ? "Apply this commit to the current branch." : "Create a new commit that reverses this commit."}</p>
          <p>The working tree must be clean. Conflicts will move to the Changes view for resolution.</p>
        </div>
        <footer>
          <button type="button" disabled={running} onClick={history.cancelCommitAction}>Cancel</button>
          <button type="button" className="git-stash-dialog__primary" disabled={running} onClick={() => void history.confirmCommitAction()}>{running ? `${label}ing...` : label}</button>
        </footer>
      </section>
    </div>
  );
}

function CommitFileList({ history }: GitHistoryViewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const files = history.details?.files ?? [];

  useEffect(() => {
    const index = files.findIndex((file) => file.path === history.selectedFilePath);
    if (index >= 0) rowRefs.current[index]?.scrollIntoView?.({ block: "nearest" });
  }, [files, history.selectedFilePath]);

  function moveSelection(delta: number) {
    if (!files.length) return;
    const current = files.findIndex((file) => file.path === history.selectedFilePath);
    const next = Math.max(0, Math.min(files.length - 1, current < 0 ? 0 : current + delta));
    history.selectCommitFile(files[next]);
    rowRefs.current[next]?.focus();
  }

  function openSelected() {
    const file = files.find((candidate) => candidate.path === history.selectedFilePath) ?? files[0];
    if (file) void history.openCommitFileDiff(file);
  }

  return (
    <div
      ref={listRef}
      className="git-history__files"
      role="listbox"
      aria-label="Changed files"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveSelection(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveSelection(-1);
        } else if (event.key === "Home" && files[0]) {
          event.preventDefault();
          history.selectCommitFile(files[0]);
          rowRefs.current[0]?.focus();
        } else if (event.key === "End" && files.length) {
          event.preventDefault();
          history.selectCommitFile(files[files.length - 1]);
          rowRefs.current[files.length - 1]?.focus();
        } else if (event.key === "Enter") {
          event.preventDefault();
          openSelected();
        }
      }}
    >
      {files.map((file, index) => (
        <CommitFileRow
          key={`${file.status}:${file.path}`}
          file={file}
          selected={file.path === history.selectedFilePath}
          rowRef={(node) => { rowRefs.current[index] = node; }}
          onSelect={() => history.selectCommitFile(file)}
          onOpen={() => void history.openCommitFileDiff(file)}
        />
      ))}
      {history.details?.filesTruncated ? <div className="git-history__files-truncated">Additional changed files were omitted to protect responsiveness.</div> : null}
    </div>
  );
}

function CommitFileRow({ file, selected, rowRef, onSelect, onOpen }: {
  file: GitCommitFile;
  selected: boolean;
  rowRef: (node: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      role="option"
      aria-label={file.path}
      aria-selected={selected}
      className={`git-history__file${selected ? " git-history__file--selected" : ""}`}
      title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      onClick={onOpen}
    >
      <span className={`git-history__file-status git-history__file-status--${file.status[0]?.toLowerCase()}`}>{file.status}</span>
      <span>{file.path}</span>
    </button>
  );
}

function filterCommits(commits: GitCommitSummary[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return commits;
  return commits.filter((commit) => [commit.subject, commit.author, commit.authorEmail, commit.shortCommit, ...commit.refs]
    .some((value) => value.toLocaleLowerCase().includes(normalized)));
}

function relativeTime(epochSeconds: number) {
  const deltaSeconds = epochSeconds - Math.floor(Date.now() / 1000);
  const ranges: Array<[number, Intl.RelativeTimeFormatUnit]> = [[86_400 * 365, "year"], [86_400 * 30, "month"], [86_400, "day"], [3_600, "hour"], [60, "minute"]];
  const [divisor, unit] = ranges.find(([value]) => Math.abs(deltaSeconds) >= value) ?? [1, "second"];
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(deltaSeconds / divisor), unit);
}
