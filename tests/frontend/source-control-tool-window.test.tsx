import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { SourceControlToolWindow } from "@/components/layout/SourceControlToolWindow";
import type { GitChangeEntry, GitRepositorySnapshot } from "@/features/git/git-source-control-model";

const tracked = change("src/main.ets", ".M", "modified", { unstaged: true });
const staged = change("src/staged.ets", "M.", "modified", { staged: true });
const partiallyStaged = change("src/partial.ets", "MM", "modified", { staged: true, unstaged: true });
const unversioned = change("notes.txt", "??", "untracked", { unstaged: true });
const conflicted = change("src/conflict.ets", "UU", "conflicted", { unstaged: true, conflicted: true });
const changes = [tracked, staged, unversioned, conflicted];

describe("IDEA-style Commit tool window", () => {
  it("groups changes and defaults tracked files to included", () => {
    const props = createProps();
    render(<SourceControlToolWindow {...props} />);

    expect(screen.getByText("feature/git-ui")).toBeVisible();
    expect(screen.getByText("↑2 ↓1")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Changes" })).getByText("main.ets")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Unversioned Files" })).getByText("notes.txt")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Include src/main.ets" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include notes.txt" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include src/conflict.ets" })).toBeDisabled();
  });

  it("uses inclusion controls to define commit scope", async () => {
    const user = userEvent.setup();
    const props = createProps();
    render(<SourceControlToolWindow {...props} />);

    await user.click(screen.getByRole("checkbox", { name: "Include notes.txt" }));
    expect(props.selection.toggle).toHaveBeenCalledWith(unversioned);
    expect(screen.queryByText(/Stage All/i)).not.toBeInTheDocument();
  });

  it("shows a partially included file as mixed until the user expands it", async () => {
    const user = userEvent.setup();
    const selection = {
      includedPaths: new Set([partiallyStaged.relativePath]), partiallyIncludedPaths: new Set([partiallyStaged.relativePath]),
      includedCount: 1, preparing: false, error: null, toggle: vi.fn(), setGroup: vi.fn(), prepare: vi.fn(),
    };
    const props = createProps({
      snapshot: { ...snapshot, changes: [partiallyStaged], totalChanges: 1, stagedChanges: 1, conflictedChanges: 0 },
      selection,
    });
    render(<SourceControlToolWindow {...props} />);

    const fileCheckbox = screen.getByRole("checkbox", { name: "Include src/partial.ets" }) as HTMLInputElement;
    expect(fileCheckbox.indeterminate).toBe(true);
    expect(screen.getByText("Partial")).toBeVisible();
    expect(screen.getByText("1 of 1 files included · 1 partial")).toBeVisible();
    expect((screen.getByRole("checkbox", { name: "Include all Changes" }) as HTMLInputElement).indeterminate).toBe(true);
    await user.click(fileCheckbox);
    expect(selection.toggle).toHaveBeenCalledWith(partiallyStaged);
  });

  it("opens a commit-scope diff and opens the editor on double click", () => {
    const props = createProps();
    render(<SourceControlToolWindow {...props} />);
    const row = screen.getByTitle("src/main.ets");

    fireEvent.click(row);
    expect(props.onOpenDiff).toHaveBeenCalledWith({ entry: tracked, staged: false, commitView: true });
    fireEvent.doubleClick(row);
    expect(props.onOpenFile).toHaveBeenCalledWith("/workspace/src/main.ets");
  });

  it("keeps the commit composer fixed in the workflow and supports Commit and Push", async () => {
    const user = userEvent.setup();
    const props = createProps({ snapshot: { ...snapshot, changes: changes.filter((entry) => !entry.conflicted), conflictedChanges: 0, totalChanges: 3 }, commitDraft: { message: "Refine Git UI", amend: false, signOff: false } });
    render(<SourceControlToolWindow {...props} />);

    expect(screen.getByRole("button", { name: "Commit (2)" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "More commit actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Commit and Push" }));
    expect(props.onCommit).toHaveBeenCalledWith("commitAndPush");
  });

  it("uses IDEA rollback terminology and preserves undo", async () => {
    const user = userEvent.setup();
    const props = createProps({ discard: { ...emptyDiscard(), pending: tracked, backup: { commit: "abc", path: tracked.relativePath } } });
    render(<SourceControlToolWindow {...props} />);

    expect(screen.getByRole("dialog", { name: "Rollback Changes" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Rollback" }));
    expect(props.discard.confirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(props.discard.restore).toHaveBeenCalledOnce();
  });

  it("opens Push Commits and paginates before allowing a complete commit", async () => {
    const user = userEvent.setup();
    const props = createProps({ snapshot: { ...snapshot, hasMore: true, nextCursor: "next", totalChanges: 800 } });
    render(<SourceControlToolWindow {...props} />);

    await user.click(screen.getByRole("button", { name: "Push…" }));
    expect(props.onOpenPush).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Load More (4/800)" }));
    expect(props.onLoadMoreChanges).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Commit (2)" })).toBeDisabled();
  });

  it("switches repositories in a multi-root workspace", async () => {
    const user = userEvent.setup();
    const props = createProps({ snapshot: { ...snapshot, rootPath: "/workspace/app", repositoryRoot: "/workspace/app" }, gitRoots: ["/workspace/app", "/workspace/lib"] });
    render(<SourceControlToolWindow {...props} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Git repository" }), "/workspace/lib");
    expect(props.onSelectGitRoot).toHaveBeenCalledWith("/workspace/lib");
  });
});

const snapshot: GitRepositorySnapshot = {
  rootPath: "/workspace", repositoryRoot: "/workspace", currentBranch: "feature/git-ui", detached: false,
  upstream: "origin/feature/git-ui", ahead: 2, behind: 1, operation: "idle", generation: 1,
  snapshotId: "snapshot-1", totalChanges: 4, stagedChanges: 1, conflictedChanges: 1,
  nextCursor: null, hasMore: false, changes,
};

function createProps(overrides: Partial<ComponentProps<typeof SourceControlToolWindow>> = {}): ComponentProps<typeof SourceControlToolWindow> {
  return {
    snapshot, selected: null,
    selection: { includedPaths: new Set([tracked.relativePath, staged.relativePath]), partiallyIncludedPaths: new Set(), includedCount: 2, preparing: false, error: null, toggle: vi.fn(), setGroup: vi.fn(), prepare: vi.fn() },
    commitDraft: { message: "", amend: false, signOff: false }, commitFocusToken: 0, operation: "idle", error: null,
    loadingMoreChanges: false, loadingAmendMessage: false, conflict: emptyConflict(), discard: emptyDiscard(), dirtyGuard: emptyDirtyGuard(),
    onChangeCommitMessage: vi.fn(), onChangeCommitAmend: vi.fn(), onChangeCommitSignOff: vi.fn(), onRefresh: vi.fn(),
    gitRoots: ["/workspace"], onSelectGitRoot: vi.fn(), onLoadMoreChanges: vi.fn(), onCommit: vi.fn(), onOpenPush: vi.fn(), onOpenDiff: vi.fn(), onOpenFile: vi.fn(), ...overrides,
  } as ComponentProps<typeof SourceControlToolWindow>;
}

function change(relativePath: string, statusCode: string, kind: GitChangeEntry["kind"], extra: Partial<GitChangeEntry>): GitChangeEntry {
  return { absolutePath: `/workspace/${relativePath}`, relativePath, originalPath: null, statusCode, kind, staged: false, unstaged: false, conflicted: false, ...extra };
}

function emptyDiscard() { return { pending: null, backup: null, discarding: false, restoring: false, request: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), restore: vi.fn(), dismissBackup: vi.fn() }; }
function emptyConflict() { return { entry: null, content: null, resolution: null, loading: false, saving: false, error: null, open: vi.fn(), close: vi.fn(), setResolution: vi.fn(), save: vi.fn(), continueOperation: vi.fn(), abortOperation: vi.fn() }; }
function emptyDirtyGuard() { return { pending: null, saving: false, error: null, ensureReady: vi.fn(), cancel: vi.fn(), saveAndContinue: vi.fn() }; }
