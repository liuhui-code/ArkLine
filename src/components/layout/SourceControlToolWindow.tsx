import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { GitChangeEntry, GitChangeSelection, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import { getPathBasename } from "@/features/workspace/workspace-store";
import { GitHistoryView } from "@/components/layout/GitHistoryView";
import type { GitHistoryController } from "@/components/layout/use-git-history-controller";
import { GitConflictResolver } from "@/components/layout/GitConflictResolver";
import { GitDiscardDialog } from "@/components/layout/GitDiscardDialog";
import { ContextMenu, type ContextMenuState } from "@/components/layout/ContextMenu";
import type { SourceControlConflictController, SourceControlDiscardController } from "@/components/layout/use-source-control-controller";
import { GitCommitComposer } from "@/components/layout/GitCommitComposer";
import type { GitCommitAction, GitCommitDraft } from "@/features/git/git-commit-model";
import { GitStashView } from "@/components/layout/GitStashView";
import type { GitStashController } from "@/components/layout/use-git-stash-controller";
import { GitDirtyDocumentsDialog } from "@/components/layout/GitDirtyDocumentsDialog";
import type { GitWorkingTreeGuardController } from "@/components/layout/use-git-working-tree-guard";

type SourceControlToolWindowProps = {
  snapshot: GitRepositorySnapshot | null;
  selected: GitChangeSelection | null;
  commitDraft: GitCommitDraft;
  operation: string;
  error: string | null;
  loadingMoreChanges: boolean;
  loadingAmendMessage: boolean;
  history: GitHistoryController;
  conflict: SourceControlConflictController;
  discard: SourceControlDiscardController;
  stash: GitStashController;
  dirtyGuard: GitWorkingTreeGuardController;
  onChangeCommitMessage: (message: string) => void;
  onChangeCommitAmend: (amend: boolean) => void;
  onChangeCommitSignOff: (signOff: boolean) => void;
  onRefresh: () => void;
  onLoadMoreChanges: () => void;
  onCommit: (action: GitCommitAction) => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onOpenDiff: (selection: GitChangeSelection) => void;
  onOpenFile: (path: string) => void;
  onStage: (entry: GitChangeEntry) => void;
  onUnstage: (entry: GitChangeEntry) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
};

type ChangeGroup = {
  id: string;
  label: string;
  entries: GitChangeEntry[];
  staged: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export function SourceControlToolWindow(props: SourceControlToolWindowProps) {
  const [view, setView] = useState<"changes" | "history" | "stashes">("changes");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const snapshot = props.snapshot;
  const busy = (props.operation !== "idle" && props.operation !== "refreshing") || props.stash.operation !== "idle" || props.history.actionStatus !== "idle";
  const groups = buildGroups(snapshot, props);
  const stagedCount = snapshot?.stagedChanges ?? 0;
  const conflictCount = snapshot?.conflictedChanges ?? 0;

  useEffect(() => {
    if (snapshot?.operation !== "idle") setView("changes");
  }, [snapshot?.operation]);

  return (
    <section className="source-control" aria-label="Source Control">
      <header className="source-control__header">
        <div className="source-control__title">
          <strong>{snapshot?.currentBranch ?? (snapshot?.detached ? "Detached HEAD" : "No repository")}</strong>
        </div>
        <div className="source-control__header-actions">
          <button type="button" disabled={busy || !snapshot} onClick={props.onFetch}>Fetch</button>
          <button type="button" disabled={busy || !snapshot || snapshot.detached} onClick={props.onPull}>Pull</button>
          <button type="button" disabled={busy || !snapshot || snapshot.detached} onClick={props.onPush}>Push</button>
          <button type="button" className="source-control__icon-button" aria-label="Refresh Source Control" title="Refresh" disabled={busy} onClick={props.onRefresh}>↻</button>
        </div>
      </header>
      {snapshot ? (
        <div className="source-control__branch-summary">
          <span>{snapshot.upstream ?? "No upstream"}</span>
          <span>{`↑${snapshot.ahead} ↓${snapshot.behind}`}</span>
          {snapshot.operation !== "idle" ? <strong>{snapshot.operation}</strong> : null}
        </div>
      ) : null}
      <div className="source-control__views" role="tablist" aria-label="Source Control views">
        <button type="button" role="tab" aria-selected={view === "changes"} onClick={() => setView("changes")}>Changes</button>
        <button type="button" role="tab" aria-selected={view === "history"} onClick={() => setView("history")}>Log</button>
        <button type="button" role="tab" aria-selected={view === "stashes"} onClick={() => { setView("stashes"); props.stash.activate(); }}>Stashes</button>
      </div>
      {view === "changes" ? (
        <>
          {snapshot && snapshot.operation !== "idle" ? (
            <RepositoryOperationControls
              operation={snapshot.operation}
              conflictCount={conflictCount}
              busy={busy}
              onContinue={props.conflict.continueOperation}
              onAbort={props.conflict.abortOperation}
            />
          ) : null}
          <GitCommitComposer
            draft={props.commitDraft}
            stagedCount={stagedCount}
            conflictCount={conflictCount}
            disabled={busy || !snapshot}
            committing={props.operation === "commit"}
            loadingAmendMessage={props.loadingAmendMessage}
            onChangeMessage={props.onChangeCommitMessage}
            onChangeAmend={props.onChangeCommitAmend}
            onChangeSignOff={props.onChangeCommitSignOff}
            onCommit={props.onCommit}
          />
          {props.error ? <div className="source-control__error" role="alert">{props.error}</div> : null}
          {props.discard.backup ? (
            <div className="source-control__undo" role="status">
              <span>Discarded {getPathBasename(props.discard.backup.path)}</span>
              <button type="button" disabled={busy || props.discard.restoring} onClick={() => void props.discard.restore()}>{props.discard.restoring ? "Restoring..." : "Undo"}</button>
              <button type="button" aria-label="Dismiss discard backup" disabled={props.discard.restoring} onClick={props.discard.dismissBackup}>×</button>
            </div>
          ) : null}
          <div className="source-control__groups" aria-busy={busy}>
            {!snapshot && !props.error ? <p className="source-control__empty">{props.operation === "refreshing" ? "Loading repository..." : "Open a Git repository to view changes."}</p> : null}
            {snapshot && groups.every((group) => group.entries.length === 0) ? <p className="source-control__empty">No local changes</p> : null}
            {groups.map((group) => group.entries.length > 0 ? (
              <ChangeSection
                key={group.id}
                group={group}
                busy={busy}
                selected={props.selected}
                onOpenDiff={props.onOpenDiff}
                onOpenFile={props.onOpenFile}
                onOpenConflict={props.conflict.open}
                onContextMenu={(event, entry) => openChangeContextMenu(event, entry, group.staged, props, setContextMenu)}
                onStage={props.onStage}
                onUnstage={props.onUnstage}
              />
            ) : null)}
            {snapshot?.hasMore ? (
              <button
                type="button"
                className="source-control__load-more"
                disabled={busy || props.loadingMoreChanges}
                onClick={props.onLoadMoreChanges}
              >
                {props.loadingMoreChanges ? "Loading..." : `Load More (${snapshot.changes.length}/${snapshot.totalChanges})`}
              </button>
            ) : null}
          </div>
        </>
      ) : view === "history" ? <GitHistoryView history={props.history} /> : <GitStashView stash={props.stash} />}
      <footer className="source-control__footer">
        <span>{view === "history" ? `${props.history.commits.length} commits loaded` : view === "stashes" ? `${props.stash.entries.length} of ${props.stash.total} stashes loaded` : snapshot ? changeSummary(snapshot) : "Git unavailable"}</span>
        {busy ? <span>{props.stash.operation !== "idle" ? stashOperationLabel(props.stash.operation) : props.history.actionStatus !== "idle" ? historyActionLabel(props.history.actionStatus) : operationLabel(props.operation)}</span> : null}
      </footer>
      <GitConflictResolver conflict={props.conflict} />
      <GitDiscardDialog discard={props.discard} />
      <GitDirtyDocumentsDialog guard={props.dirtyGuard} />
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  );
}

function ChangeSection({
  group,
  busy,
  selected,
  onOpenDiff,
  onOpenFile,
  onOpenConflict,
  onContextMenu,
  onStage,
  onUnstage,
}: {
  group: ChangeGroup;
  busy: boolean;
  selected: GitChangeSelection | null;
  onOpenDiff: (selection: GitChangeSelection) => void;
  onOpenFile: (path: string) => void;
  onOpenConflict: (entry: GitChangeEntry) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, entry: GitChangeEntry) => void;
  onStage: (entry: GitChangeEntry) => void;
  onUnstage: (entry: GitChangeEntry) => void;
}) {
  return (
    <section className="source-control__group" aria-label={group.label}>
      <header className="source-control__group-header">
        <strong>{group.label}</strong>
        <span>{group.entries.length}</span>
        {group.onAction ? <button type="button" disabled={busy} onClick={group.onAction}>{group.actionLabel}</button> : null}
      </header>
      <div role="list">
        {group.entries.map((entry) => {
          const active = selected?.entry.relativePath === entry.relativePath && selected.staged === group.staged;
          return (
            <div key={`${group.id}:${entry.relativePath}`} className={`source-control__change${active ? " source-control__change--active" : ""}`} role="listitem" onContextMenu={(event) => onContextMenu(event, entry)}>
              <button
                type="button"
                className="source-control__change-main"
                title={entry.relativePath}
                onClick={() => entry.conflicted ? onOpenConflict(entry) : onOpenDiff({ entry, staged: group.staged })}
                onDoubleClick={() => onOpenFile(entry.absolutePath)}
              >
                <span className="source-control__filename">{getPathBasename(entry.relativePath)}</span>
                <span className="source-control__path">{parentPath(entry.relativePath)}</span>
                <span className={`source-control__status source-control__status--${entry.kind}`}>{statusLabel(entry, group.staged)}</span>
              </button>
              {!entry.conflicted ? (
                <button
                  type="button"
                  className="source-control__row-action"
                  aria-label={`${group.staged ? "Unstage" : "Stage"} ${entry.relativePath}`}
                  title={group.staged ? "Unstage" : "Stage"}
                  disabled={busy}
                  onClick={() => group.staged ? onUnstage(entry) : onStage(entry)}
                >
                  {group.staged ? "−" : "+"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function openChangeContextMenu(
  event: ReactMouseEvent<HTMLElement>,
  entry: GitChangeEntry,
  staged: boolean,
  props: SourceControlToolWindowProps,
  openMenu: (state: ContextMenuState) => void,
) {
  event.preventDefault();
  event.stopPropagation();
  const busy = props.operation !== "idle" && props.operation !== "refreshing";
  const selection = { entry, staged };
  const items: ContextMenuState["items"] = [
    {
      id: "open-changes",
      label: entry.conflicted ? "Resolve Conflict" : "Open Changes",
      disabled: busy,
      onSelect: () => entry.conflicted ? props.conflict.open(entry) : props.onOpenDiff(selection),
    },
    { id: "open-file", label: "Open File", onSelect: () => props.onOpenFile(entry.absolutePath) },
    {
      id: staged ? "unstage" : "stage",
      label: staged ? "Unstage" : "Stage",
      separatorBefore: true,
      disabled: busy || entry.conflicted,
      onSelect: () => staged ? props.onUnstage(entry) : props.onStage(entry),
    },
  ];
  if (entry.unstaged && !entry.conflicted) {
    items.push({
      id: "discard",
      label: entry.kind === "untracked" ? "Delete Untracked File..." : "Discard Changes...",
      disabled: busy,
      onSelect: () => props.discard.request(entry),
    });
  }
  items.push({
    id: "copy-relative-path",
    label: "Copy Relative Path",
    separatorBefore: true,
    onSelect: () => void navigator.clipboard?.writeText(entry.relativePath),
  });
  openMenu({
    label: `Git actions: ${entry.relativePath}`,
    x: event.clientX,
    y: event.clientY,
    items,
  });
}

function RepositoryOperationControls({ operation, conflictCount, busy, onContinue, onAbort }: {
  operation: GitRepositorySnapshot["operation"];
  conflictCount: number;
  busy: boolean;
  onContinue: () => void;
  onAbort: () => void;
}) {
  const [confirmAbort, setConfirmAbort] = useState(false);
  const label = operation === "cherryPick" ? "Cherry-pick" : `${operation[0].toUpperCase()}${operation.slice(1)}`;
  return (
    <section className="source-control__operation" aria-label={`${label} in progress`}>
      <div><strong>{label} in progress</strong><span>{conflictCount ? `${conflictCount} unresolved conflict${conflictCount === 1 ? "" : "s"}` : "Ready to continue"}</span></div>
      {confirmAbort ? (
        <div className="source-control__abort-confirm"><span>Abort {label.toLowerCase()}?</span><button type="button" disabled={busy} onClick={() => setConfirmAbort(false)}>Cancel</button><button type="button" disabled={busy} onClick={onAbort}>Abort</button></div>
      ) : (
        <div><button type="button" disabled={busy || conflictCount > 0} onClick={onContinue}>Continue</button><button type="button" disabled={busy} onClick={() => setConfirmAbort(true)}>Abort...</button></div>
      )}
    </section>
  );
}

function buildGroups(snapshot: GitRepositorySnapshot | null, props: SourceControlToolWindowProps): ChangeGroup[] {
  const changes = snapshot?.changes ?? [];
  const localChanges = changes.filter((entry) => entry.unstaged && entry.kind !== "untracked" && !entry.conflicted);
  const untrackedChanges = changes.filter((entry) => entry.kind === "untracked");
  return [
    { id: "conflicts", label: "Conflicts", entries: changes.filter((entry) => entry.conflicted), staged: false },
    { id: "staged", label: "Staged Changes", entries: changes.filter((entry) => entry.staged && !entry.conflicted), staged: true, actionLabel: snapshot?.hasMore ? undefined : "Unstage All", onAction: snapshot?.hasMore ? undefined : props.onUnstageAll },
    { id: "changes", label: "Changes", entries: localChanges, staged: false, actionLabel: snapshot?.hasMore ? undefined : "Stage All", onAction: snapshot?.hasMore ? undefined : props.onStageAll },
    { id: "untracked", label: "Untracked Files", entries: untrackedChanges, staged: false, actionLabel: snapshot?.hasMore ? undefined : "Stage All", onAction: !snapshot?.hasMore && localChanges.length === 0 ? props.onStageAll : undefined },
  ];
}

function changeSummary(snapshot: GitRepositorySnapshot) {
  if (snapshot.hasMore || snapshot.changes.length < snapshot.totalChanges) {
    return `${snapshot.changes.length} of ${snapshot.totalChanges} changes loaded`;
  }
  return `${snapshot.totalChanges} changed file${snapshot.totalChanges === 1 ? "" : "s"}`;
}

function parentPath(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : "";
}

function statusLabel(entry: GitChangeEntry, staged: boolean) {
  if (entry.conflicted) return "U";
  if (entry.kind === "untracked") return "?";
  return staged ? entry.statusCode[0] : entry.statusCode[1];
}

function operationLabel(operation: string) {
  if (operation === "refreshing") return "Refreshing...";
  if (operation === "diff") return "Loading diff...";
  if (operation === "stage") return "Staging...";
  if (operation === "unstage") return "Unstaging...";
  if (operation === "discard") return "Discarding changes...";
  if (operation === "restoreDiscard") return "Restoring changes...";
  if (operation === "fetch") return "Fetching...";
  if (operation === "pull") return "Pulling...";
  if (operation === "push") return "Pushing...";
  if (operation === "conflict") return "Loading conflict...";
  if (operation === "resolveConflict") return "Resolving conflict...";
  if (operation === "continue") return "Continuing operation...";
  if (operation === "abort") return "Aborting operation...";
  return operation === "commit" ? "Committing..." : "";
}

function stashOperationLabel(operation: GitStashController["operation"]) {
  if (operation === "loading") return "Loading stashes...";
  if (operation === "diffing") return "Loading stash diff...";
  if (operation === "creating") return "Stashing changes...";
  if (operation === "applying") return "Applying stash...";
  if (operation === "popping") return "Popping stash...";
  return operation === "dropping" ? "Dropping stash..." : "";
}

function historyActionLabel(action: GitHistoryController["actionStatus"]) {
  if (action === "cherryPick") return "Cherry-picking commit...";
  return action === "revert" ? "Reverting commit..." : "";
}
