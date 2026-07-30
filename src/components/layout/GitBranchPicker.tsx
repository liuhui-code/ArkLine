import { useEffect, useRef } from "react";
import type { GitBranchPickerItem } from "@/components/layout/use-git-branch-controller";

type GitBranchPickerProps = {
  open: boolean;
  currentBranch: string;
  query: string;
  items: GitBranchPickerItem[];
  selectedIndex: number;
  loading: boolean;
  switching: boolean;
  error: string | null;
  pendingCheckout: GitBranchPickerItem | null;
  workingTreeChangedFiles: number;
  workingTreeConflictedFiles: number;
  onChangeQuery: (query: string) => void;
  onSelectIndex: (index: number) => void;
  onMoveSelection: (delta: number) => void;
  onCheckout: (item: GitBranchPickerItem) => void;
  onCheckoutSelected: () => void;
  onCancelPendingCheckout: () => void;
  onPreserveAndCheckout: () => void;
  onStashAndCheckout: () => void;
  onClose: () => void;
};

export function GitBranchPicker({
  open,
  currentBranch,
  query,
  items,
  selectedIndex,
  loading,
  switching,
  error,
  pendingCheckout,
  workingTreeChangedFiles,
  workingTreeConflictedFiles,
  onChangeQuery,
  onSelectIndex,
  onMoveSelection,
  onCheckout,
  onCheckoutSelected,
  onCancelPendingCheckout,
  onPreserveAndCheckout,
  onStashAndCheckout,
  onClose,
}: GitBranchPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;
  let lastGroup = "";

  return (
    <section
      className="git-branch-picker"
      role="dialog"
      aria-modal="true"
      aria-label="Switch Git Branch"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (pendingCheckout) onCancelPendingCheckout();
          else onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onMoveSelection(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          onMoveSelection(-1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (!pendingCheckout) onCheckoutSelected();
        }
      }}
    >
      <div className="git-branch-picker__panel" onMouseDown={(event) => event.stopPropagation()}>
        <header className="git-branch-picker__header">
          <div>
            <strong>Switch Branch</strong>
            <span>Current: {currentBranch}</span>
          </div>
          <button type="button" className="git-branch-picker__close" aria-label="Close Branch Picker" onClick={onClose}>×</button>
        </header>
        <div className="git-branch-picker__search-row">
          <span className="git-branch-picker__search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            aria-label="Search branches"
            className="git-branch-picker__input"
            value={query}
            disabled={Boolean(pendingCheckout) || switching}
            placeholder="Search branches..."
            onChange={(event) => onChangeQuery(event.target.value)}
          />
        </div>
        {pendingCheckout ? (
          <BranchCheckoutPreflight
            branch={pendingCheckout}
            changedFiles={workingTreeChangedFiles}
            switching={switching}
            onCancel={onCancelPendingCheckout}
            onPreserve={onPreserveAndCheckout}
            onStash={onStashAndCheckout}
          />
        ) : <div className="git-branch-picker__list" role="listbox" aria-label="Git branches" aria-busy={loading || switching}>
          {loading ? <div className="git-branch-picker__empty">Loading branches...</div> : null}
          {!loading && items.length === 0 ? <div className="git-branch-picker__empty">No matching branches</div> : null}
          {!loading ? items.map((item, index) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={`${item.kind}:${item.name}`}>
                {showGroup ? <div className="git-branch-picker__group-label">{item.group}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedIndex === index}
                  className={`git-branch-picker__item${selectedIndex === index ? " git-branch-picker__item--selected" : ""}`}
                  onMouseEnter={() => onSelectIndex(index)}
                  onClick={() => onCheckout(item)}
                >
                  <span className="git-branch-picker__branch-mark" aria-hidden="true">{item.current ? "●" : "○"}</span>
                  <span className="git-branch-picker__branch-name">{item.displayName}</span>
                  {item.upstream ? <span className="git-branch-picker__upstream">{item.upstream}</span> : null}
                  {item.ahead || item.behind ? <span className="git-branch-picker__tracking">↑{item.ahead} ↓{item.behind}</span> : null}
                </button>
              </div>
            );
          }) : null}
        </div>}
        <footer className="git-branch-picker__footer">
          <span className={error ? "git-branch-picker__error" : "git-branch-picker__hint"} role={error ? "alert" : undefined}>
            {error ?? (workingTreeConflictedFiles > 0
              ? `${workingTreeConflictedFiles} conflicted file${workingTreeConflictedFiles === 1 ? "" : "s"} in working tree`
              : workingTreeChangedFiles > 0
                ? `${workingTreeChangedFiles} changed file${workingTreeChangedFiles === 1 ? "" : "s"} in working tree`
                : "Enter checkout · ↑↓ navigate · Esc close")}
          </span>
          {switching ? <span>Switching...</span> : null}
        </footer>
      </div>
    </section>
  );
}

function BranchCheckoutPreflight({
  branch,
  changedFiles,
  switching,
  onCancel,
  onPreserve,
  onStash,
}: {
  branch: GitBranchPickerItem;
  changedFiles: number;
  switching: boolean;
  onCancel: () => void;
  onPreserve: () => void;
  onStash: () => void;
}) {
  return (
    <section className="git-branch-picker__preflight" aria-label="Branch checkout options">
      <strong>Working tree has local changes</strong>
      <p>{`Switch to ${branch.displayName} with ${changedFiles} changed file${changedFiles === 1 ? "" : "s"}?`}</p>
      <p className="git-branch-picker__preflight-detail">Smart checkout temporarily stashes tracked and untracked changes, switches branch, then restores them.</p>
      <div className="git-branch-picker__preflight-actions">
        <button type="button" disabled={switching} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={switching} onClick={onPreserve}>Keep Changes &amp; Switch</button>
        <button type="button" className="git-branch-picker__primary" disabled={switching} onClick={onStash}>Smart Checkout</button>
      </div>
    </section>
  );
}
