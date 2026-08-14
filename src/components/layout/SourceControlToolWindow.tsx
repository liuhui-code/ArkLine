import { useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { GitChangeEntry, GitChangeSelection, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import { getPathBasename } from "@/features/workspace/workspace-store";
import { GitConflictResolver } from "@/components/layout/GitConflictResolver";
import { GitDiscardDialog } from "@/components/layout/GitDiscardDialog";
import { ContextMenu, type ContextMenuState } from "@/components/layout/ContextMenu";
import type { SourceControlConflictController, SourceControlDiscardController } from "@/components/layout/use-source-control-controller";
import { GitCommitComposer } from "@/components/layout/GitCommitComposer";
import type { GitCommitAction, GitCommitDraft } from "@/features/git/git-commit-model";
import { GitDirtyDocumentsDialog } from "@/components/layout/GitDirtyDocumentsDialog";
import type { GitWorkingTreeGuardController } from "@/components/layout/use-git-working-tree-guard";
import type { GitCommitSelectionController } from "@/components/layout/use-git-commit-selection";

type Props = {
  snapshot: GitRepositorySnapshot | null;
  selected: GitChangeSelection | null;
  selection: GitCommitSelectionController;
  commitDraft: GitCommitDraft;
  commitFocusToken: number;
  operation: string;
  error: string | null;
  loadingMoreChanges: boolean;
  loadingAmendMessage: boolean;
  conflict: SourceControlConflictController;
  discard: SourceControlDiscardController;
  dirtyGuard: GitWorkingTreeGuardController;
  onChangeCommitMessage: (message: string) => void;
  onChangeCommitAmend: (amend: boolean) => void;
  onChangeCommitSignOff: (signOff: boolean) => void;
  onRefresh: () => void;
  onLoadMoreChanges: () => void;
  onCommit: (action: GitCommitAction) => void;
  onOpenPush: () => void;
  onOpenDiff: (selection: GitChangeSelection) => void;
  onOpenFile: (path: string) => void;
  gitRoots: string[];
  onSelectGitRoot: (root: string) => void;
};

type ChangeGroup = { id: string; label: string; entries: GitChangeEntry[] };

export function SourceControlToolWindow(props: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const snapshot = props.snapshot;
  const busy = (props.operation !== "idle" && props.operation !== "refreshing") || props.selection.preparing;
  const groups = buildGroups(snapshot);
  const conflictCount = snapshot?.conflictedChanges ?? 0;
  return (
    <section className="source-control source-control--commit" aria-label="Commit">
      <header className="source-control__header">
        <div className="source-control__title"><strong>Commit</strong><span>{snapshot?.currentBranch ?? "No Git repository"}</span></div>
        <div className="source-control__header-actions">
          <button type="button" disabled={busy || !snapshot} onClick={props.onOpenPush}>Push…</button>
          <button type="button" className="source-control__icon-button" aria-label="Refresh Local Changes" title="Refresh Local Changes (Ctrl+F5)" disabled={busy} onClick={props.onRefresh}>↻</button>
        </div>
      </header>
      {props.gitRoots.length > 1 ? <label className="source-control__root"><span>Repository</span><select aria-label="Git repository" value={snapshot?.rootPath ?? props.gitRoots[0]} onChange={(event) => props.onSelectGitRoot(event.target.value)}>{props.gitRoots.map((root) => <option key={root} value={root}>{rootLabel(root)}</option>)}</select></label> : null}
      {snapshot ? <div className="source-control__branch-summary"><span>{snapshot.repositoryRoot}</span><span>{snapshot.upstream ?? "No upstream"}</span><strong>{`↑${snapshot.ahead} ↓${snapshot.behind}`}</strong></div> : null}
      {snapshot && snapshot.operation !== "idle" ? <RepositoryOperationControls operation={snapshot.operation} conflictCount={conflictCount} busy={busy} onContinue={props.conflict.continueOperation} onAbort={props.conflict.abortOperation} /> : null}
      <div className="source-control__groups source-control__groups--commit" aria-busy={busy}>
        {!snapshot && !props.error ? <p className="source-control__empty">Open a Git repository to view local changes.</p> : null}
        {snapshot && groups.every((group) => group.entries.length === 0) ? <p className="source-control__empty">No local changes</p> : null}
        {groups.map((group) => group.entries.length ? <ChangeSection key={group.id} group={group} busy={busy} selected={props.selected} includedPaths={props.selection.includedPaths} onSetGroup={props.selection.setGroup} onToggle={props.selection.toggle} onOpenDiff={props.onOpenDiff} onOpenFile={props.onOpenFile} onOpenConflict={props.conflict.open} onContextMenu={(event, entry) => openChangeContextMenu(event, entry, props, setContextMenu)} /> : null)}
        {snapshot?.hasMore ? <button type="button" className="source-control__load-more" disabled={busy || props.loadingMoreChanges} onClick={props.onLoadMoreChanges}>{props.loadingMoreChanges ? "Loading…" : `Load More (${snapshot.changes.length}/${snapshot.totalChanges})`}</button> : null}
      </div>
      {props.discard.backup ? <div className="source-control__undo" role="status"><span>Rolled back {getPathBasename(props.discard.backup.path)}</span><button type="button" disabled={busy || props.discard.restoring} onClick={() => void props.discard.restore()}>Undo</button><button type="button" aria-label="Dismiss rollback backup" onClick={props.discard.dismissBackup}>×</button></div> : null}
      {props.error || props.selection.error ? <div className="source-control__error" role="alert">{props.selection.error ?? props.error}</div> : null}
      <GitCommitComposer draft={props.commitDraft} stagedCount={props.selection.includedCount} conflictCount={conflictCount} disabled={busy || !snapshot || Boolean(snapshot?.hasMore)} committing={props.operation === "commit"} loadingAmendMessage={props.loadingAmendMessage} focusToken={props.commitFocusToken} onChangeMessage={props.onChangeCommitMessage} onChangeAmend={props.onChangeCommitAmend} onChangeSignOff={props.onChangeCommitSignOff} onCommit={props.onCommit} />
      <footer className="source-control__footer"><span>{snapshot ? `${props.selection.includedCount} of ${snapshot.totalChanges} changes selected` : "Git unavailable"}</span><span>{operationLabel(props.operation)}</span></footer>
      <GitConflictResolver conflict={props.conflict} />
      <GitDiscardDialog discard={props.discard} />
      <GitDirtyDocumentsDialog guard={props.dirtyGuard} />
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  );
}

function ChangeSection({ group, busy, selected, includedPaths, onSetGroup, onToggle, onOpenDiff, onOpenFile, onOpenConflict, onContextMenu }: {
  group: ChangeGroup; busy: boolean; selected: GitChangeSelection | null; includedPaths: Set<string>;
  onSetGroup: (entries: GitChangeEntry[], included: boolean) => void; onToggle: (entry: GitChangeEntry) => void;
  onOpenDiff: (selection: GitChangeSelection) => void; onOpenFile: (path: string) => void; onOpenConflict: (entry: GitChangeEntry) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, entry: GitChangeEntry) => void;
}) {
  const selectable = group.entries.filter((entry) => !entry.conflicted);
  const allIncluded = selectable.length > 0 && selectable.every((entry) => includedPaths.has(entry.relativePath));
  return <section className="source-control__group" aria-label={group.label}>
    <header className="source-control__group-header"><input type="checkbox" aria-label={`Include all ${group.label}`} checked={allIncluded} disabled={!selectable.length || busy} onChange={() => onSetGroup(selectable, !allIncluded)} /><strong>{group.label}</strong><span>{group.entries.length}</span></header>
    <div role="listbox" aria-label={`${group.label} files`}>{group.entries.map((entry) => {
      const active = selected?.entry.relativePath === entry.relativePath;
      const included = includedPaths.has(entry.relativePath);
      const open = () => entry.conflicted ? onOpenConflict(entry) : onOpenDiff({ entry, staged: false, commitView: true });
      return <div key={entry.relativePath} className={`source-control__change${active ? " source-control__change--active" : ""}`} role="option" aria-selected={active} tabIndex={0} onContextMenu={(event) => onContextMenu(event, entry)} onKeyDown={(event) => handleRowKey(event, entry, open, onToggle)}>
        <input type="checkbox" aria-label={`Include ${entry.relativePath}`} checked={included} disabled={busy || entry.conflicted} onChange={() => onToggle(entry)} />
        <button type="button" className="source-control__change-main" title={entry.relativePath} onClick={open} onDoubleClick={() => onOpenFile(entry.absolutePath)}><span className="source-control__filename">{getPathBasename(entry.relativePath)}</span><span className="source-control__path">{parentPath(entry.relativePath)}</span><span className={`source-control__status source-control__status--${entry.kind}`}>{statusLabel(entry)}</span></button>
      </div>;
    })}</div>
  </section>;
}

function handleRowKey(event: KeyboardEvent<HTMLElement>, entry: GitChangeEntry, open: () => void, toggle: (entry: GitChangeEntry) => void) {
  if (event.key === " ") { event.preventDefault(); toggle(entry); }
  if (event.key === "Enter") { event.preventDefault(); open(); }
}

function openChangeContextMenu(event: ReactMouseEvent<HTMLElement>, entry: GitChangeEntry, props: Props, openMenu: (state: ContextMenuState) => void) {
  event.preventDefault();
  const items: ContextMenuState["items"] = [
    { id: "diff", label: entry.conflicted ? "Resolve Conflict" : "Show Diff", shortcut: "Ctrl+D", onSelect: () => entry.conflicted ? props.conflict.open(entry) : props.onOpenDiff({ entry, staged: false, commitView: true }) },
    { id: "open", label: "Open File", onSelect: () => props.onOpenFile(entry.absolutePath) },
  ];
  if (entry.unstaged && !entry.conflicted) items.push({ id: "rollback", label: entry.kind === "untracked" ? "Delete Unversioned File…" : "Rollback Changes…", separatorBefore: true, onSelect: () => props.discard.request(entry) });
  items.push({ id: "copy", label: "Copy Relative Path", separatorBefore: true, onSelect: () => void navigator.clipboard?.writeText(entry.relativePath) });
  openMenu({ label: `Change actions: ${entry.relativePath}`, x: event.clientX, y: event.clientY, items });
}

function buildGroups(snapshot: GitRepositorySnapshot | null): ChangeGroup[] {
  const changes = snapshot?.changes ?? [];
  return [
    { id: "conflicts", label: "Conflicts", entries: changes.filter((entry) => entry.conflicted) },
    { id: "changes", label: "Changes", entries: changes.filter((entry) => !entry.conflicted && entry.kind !== "untracked") },
    { id: "unversioned", label: "Unversioned Files", entries: changes.filter((entry) => entry.kind === "untracked") },
  ];
}

function parentPath(path: string) { const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")); return index > 0 ? path.slice(0, index) : ""; }
function rootLabel(path: string) { return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path; }
function statusLabel(entry: GitChangeEntry) { return entry.conflicted ? "U" : entry.kind === "untracked" ? "?" : entry.statusCode.replaceAll(".", "")[0] ?? "M"; }
function operationLabel(operation: string) { return operation === "refreshing" ? "Refreshing…" : operation === "commit" ? "Committing…" : operation === "idle" ? "" : `${operation}…`; }

function RepositoryOperationControls({ operation, conflictCount, busy, onContinue, onAbort }: { operation: GitRepositorySnapshot["operation"]; conflictCount: number; busy: boolean; onContinue: () => void; onAbort: () => void }) {
  const [confirmAbort, setConfirmAbort] = useState(false);
  const label = operation === "cherryPick" ? "Cherry-pick" : `${operation[0].toUpperCase()}${operation.slice(1)}`;
  return <section className="source-control__operation" aria-label={`${label} in progress`}><div><strong>{label} in progress</strong><span>{conflictCount ? `${conflictCount} unresolved conflicts` : "Ready to continue"}</span></div>{confirmAbort ? <div><button type="button" onClick={() => setConfirmAbort(false)}>Cancel</button><button type="button" disabled={busy} onClick={onAbort}>Abort</button></div> : <div><button type="button" disabled={busy || conflictCount > 0} onClick={onContinue}>Continue</button><button type="button" disabled={busy} onClick={() => setConfirmAbort(true)}>Abort…</button></div>}</section>;
}
