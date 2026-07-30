import { useEffect, useRef, useState } from "react";
import type { GitStashEntry } from "@/features/git/git-stash-model";
import type { GitStashController } from "@/components/layout/use-git-stash-controller";

export function GitStashView({ stash }: { stash: GitStashController }) {
  const busy = stash.operation !== "idle";
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const selected = stash.entries.findIndex((entry) => entry.reference === stash.selectedReference);
    setSelectedIndex(selected >= 0 ? selected : 0);
  }, [stash.entries, stash.selectedReference]);
  const moveSelection = (delta: number) => {
    if (!stash.entries.length) return;
    const next = Math.max(0, Math.min(stash.entries.length - 1, selectedIndex + delta));
    setSelectedIndex(next);
    rowRefs.current[next]?.focus();
    rowRefs.current[next]?.scrollIntoView?.({ block: "nearest" });
  };
  return (
    <section className="git-stashes" aria-label="Git Stashes" aria-busy={busy}>
      <header className="git-stashes__header">
        <div><strong>Stashes</strong><span>{stash.total}</span></div>
        <div>
          <button type="button" disabled={busy} onClick={stash.openCreate}>Stash Changes...</button>
          <button type="button" aria-label="Refresh stashes" title="Refresh" disabled={busy} onClick={stash.refresh}>↻</button>
        </div>
      </header>
      {stash.error ? <div className="source-control__error" role="alert">{stash.error}</div> : null}
      <div
        className="git-stashes__list"
        role="list"
        aria-label="Stashed changes"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter" && event.target === event.currentTarget && stash.entries[selectedIndex]) {
            event.preventDefault();
            void stash.openDiff(stash.entries[selectedIndex]);
          }
        }}
      >
        {!busy && stash.entries.length === 0 ? <p className="source-control__empty">No stashed changes</p> : null}
        {stash.entries.map((entry, index) => <StashRow key={entry.commit} entry={entry} stash={stash} busy={busy} previewDisabled={busy && stash.operation !== "diffing"} selected={index === selectedIndex} onSelect={() => setSelectedIndex(index)} mainRef={(node) => { rowRefs.current[index] = node; }} />)}
        {stash.hasMore ? <button type="button" className="source-control__load-more" disabled={busy} onClick={stash.loadMore}>{busy ? "Loading..." : `Load More (${stash.entries.length}/${stash.total})`}</button> : null}
      </div>
      <CreateStashDialog stash={stash} />
      <DropStashDialog stash={stash} />
    </section>
  );
}

function StashRow({ entry, stash, busy, previewDisabled, selected, onSelect, mainRef }: { entry: GitStashEntry; stash: GitStashController; busy: boolean; previewDisabled: boolean; selected: boolean; onSelect: () => void; mainRef: (node: HTMLButtonElement | null) => void }) {
  return (
    <article className={`git-stashes__row${selected ? " git-stashes__row--selected" : ""}`} role="listitem" aria-label={`${entry.reference}: ${entry.subject}`} onMouseEnter={onSelect}>
      <button ref={mainRef} type="button" className="git-stashes__row-main" disabled={previewDisabled} onFocus={onSelect} onClick={() => void stash.openDiff(entry)}>
        <strong>{stashSubject(entry.subject)}</strong>
        <span>{entry.reference} · {formatStashTime(entry.createdAtEpochSeconds)}</span>
      </button>
      <div className="git-stashes__row-actions">
        <button type="button" disabled={busy} onClick={() => void stash.apply(entry)}>Apply</button>
        <button type="button" disabled={busy} onClick={() => void stash.pop(entry)}>Pop</button>
        <button type="button" aria-label={`Drop ${entry.reference}`} title="Drop stash" disabled={busy} onClick={() => stash.requestDrop(entry)}>×</button>
      </div>
    </article>
  );
}

function CreateStashDialog({ stash }: { stash: GitStashController }) {
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [keepIndex, setKeepIndex] = useState(false);
  useEffect(() => {
    if (!stash.createOpen) setMessage("");
  }, [stash.createOpen]);
  if (!stash.createOpen) return null;
  const creating = stash.operation === "creating";
  return (
    <div className="git-stash-dialog__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) stash.closeCreate(); }}>
      <section className="git-stash-dialog" role="dialog" aria-modal="true" aria-labelledby="create-stash-title">
        <header><div><h2 id="create-stash-title">Stash Changes</h2><span>Save local changes without committing</span></div><button type="button" aria-label="Close stash dialog" disabled={creating} onClick={stash.closeCreate}>×</button></header>
        <div className="git-stash-dialog__body">
          <label><span>Message</span><input type="text" aria-label="Stash message" maxLength={500} autoFocus value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Optional description" /></label>
          <label className="git-stash-dialog__check"><input type="checkbox" checked={includeUntracked} onChange={(event) => setIncludeUntracked(event.target.checked)} /><span>Include untracked files</span></label>
          <label className="git-stash-dialog__check"><input type="checkbox" checked={keepIndex} onChange={(event) => setKeepIndex(event.target.checked)} /><span>Keep staged changes in the working tree</span></label>
        </div>
        <footer><button type="button" disabled={creating} onClick={stash.closeCreate}>Cancel</button><button type="button" className="git-stash-dialog__primary" disabled={creating} onClick={() => void stash.create(message, includeUntracked, keepIndex)}>{creating ? "Stashing..." : "Stash Changes"}</button></footer>
      </section>
    </div>
  );
}

function DropStashDialog({ stash }: { stash: GitStashController }) {
  const entry = stash.pendingDrop;
  if (!entry) return null;
  const dropping = stash.operation === "dropping";
  return (
    <div className="git-stash-dialog__backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !dropping) stash.cancelDrop(); }}>
      <section className="git-stash-dialog" role="dialog" aria-modal="true" aria-labelledby="drop-stash-title">
        <header><div><h2 id="drop-stash-title">Drop Stash</h2><span>{entry.reference}</span></div><button type="button" aria-label="Close drop confirmation" disabled={dropping} onClick={stash.cancelDrop}>×</button></header>
        <div className="git-stash-dialog__body"><strong>{stashSubject(entry.subject)}</strong><p>This permanently removes the stash reference. Apply it first if the changes may still be needed.</p></div>
        <footer><button type="button" disabled={dropping} onClick={stash.cancelDrop}>Cancel</button><button type="button" className="git-stash-dialog__danger" disabled={dropping} onClick={() => void stash.confirmDrop()}>{dropping ? "Dropping..." : "Drop Stash"}</button></footer>
      </section>
    </div>
  );
}

function stashSubject(subject: string) {
  return subject.replace(/^(WIP )?[Oo]n [^:]+:\s*/, "") || subject;
}

function formatStashTime(epochSeconds: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(epochSeconds * 1000));
}
