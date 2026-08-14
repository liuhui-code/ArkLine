import { useEffect, useRef, useState } from "react";
import { evaluateGitCommitDraft, type GitCommitAction, type GitCommitDraft } from "@/features/git/git-commit-model";

type GitCommitComposerProps = {
  draft: GitCommitDraft;
  stagedCount: number;
  focusToken?: number;
  conflictCount: number;
  disabled: boolean;
  committing: boolean;
  loadingAmendMessage: boolean;
  onChangeMessage: (message: string) => void;
  onChangeAmend: (amend: boolean) => void;
  onChangeSignOff: (signOff: boolean) => void;
  onCommit: (action: GitCommitAction) => void;
};

export function GitCommitComposer(props: GitCommitComposerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const readiness = evaluateGitCommitDraft(props.draft, props.stagedCount, props.conflictCount);
  const disabled = props.disabled || !readiness.ready;
  const primaryLabel = props.draft.amend ? "Amend Commit" : `Commit${props.stagedCount ? ` (${props.stagedCount})` : ""}`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (props.focusToken) messageRef.current?.focus();
  }, [props.focusToken]);

  return (
    <section className="git-commit-composer" aria-label="Commit changes">
      <textarea
        ref={messageRef}
        aria-label="Commit message"
        placeholder="Commit message"
        rows={3}
        value={props.draft.message}
        disabled={props.disabled}
        onChange={(event) => props.onChangeMessage(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !disabled) props.onCommit("commit");
        }}
      />
      <div className="git-commit-composer__message-meta">
        <span className={readiness.ready ? "" : "git-commit-composer__hint--blocked"}>{readiness.reason ?? "Ctrl+Enter to commit"}</span>
        <span className={readiness.subjectTooLong ? "git-commit-composer__subject-length--warning" : ""} title="Recommended subject length: 72 characters or fewer">
          {readiness.subjectLength}/72
        </span>
      </div>
      <div className="git-commit-composer__options">
        <label title="Replace the previous commit and reuse its message when this draft is empty">
          <input
            type="checkbox"
            checked={props.draft.amend}
            disabled={props.disabled || props.loadingAmendMessage}
            onChange={(event) => props.onChangeAmend(event.target.checked)}
          />
          <span>{props.loadingAmendMessage ? "Loading HEAD..." : "Amend"}</span>
        </label>
        <label title="Append a Signed-off-by trailer using your Git identity">
          <input type="checkbox" checked={props.draft.signOff} disabled={props.disabled} onChange={(event) => props.onChangeSignOff(event.target.checked)} />
          <span>Sign-off</span>
        </label>
      </div>
      <div className="git-commit-composer__actions" ref={menuRef}>
        <button type="button" className="git-commit-composer__primary" disabled={disabled} onClick={() => props.onCommit("commit")}>
          {props.committing ? "Committing..." : primaryLabel}
        </button>
        <button
          type="button"
          className="git-commit-composer__menu-button"
          aria-label="More commit actions"
          aria-expanded={menuOpen}
          disabled={disabled}
          title="More commit actions"
          onClick={() => setMenuOpen((open) => !open)}
        >
          ▾
        </button>
        {menuOpen ? (
          <div className="git-commit-composer__menu" role="menu" aria-label="Commit actions">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); props.onCommit("commitAndPush"); }}>Commit and Push</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
