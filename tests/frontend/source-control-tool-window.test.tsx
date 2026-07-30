import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceControlToolWindow } from "@/components/layout/SourceControlToolWindow";
import type { GitChangeEntry, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { GitHistoryController } from "@/components/layout/use-git-history-controller";
import type { SourceControlConflictController, SourceControlDiscardController } from "@/components/layout/use-source-control-controller";
import type { GitStashController } from "@/components/layout/use-git-stash-controller";
import type { GitWorkingTreeGuardController } from "@/components/layout/use-git-working-tree-guard";

vi.mock("@/components/layout/GitConflictCodeEditor", () => ({
  GitConflictCodeEditor: ({ ariaLabel, value, readOnly, onChange }: {
    ariaLabel: string;
    value: string;
    readOnly: boolean;
    onChange?: (value: string) => void;
  }) => <textarea aria-label={ariaLabel} value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} />,
}));

const changes: GitChangeEntry[] = [
  change("src/staged.ets", "M.", "modified", { staged: true }),
  change("src/local.ets", ".M", "modified", { unstaged: true }),
  change("src/new.ets", "??", "untracked", { unstaged: true }),
  change("src/conflict.ets", "UU", "conflicted", { unstaged: true, conflicted: true }),
];

const snapshot: GitRepositorySnapshot = {
  rootPath: "/workspace",
  repositoryRoot: "/workspace",
  currentBranch: "feature/source-control",
  detached: false,
  upstream: "origin/feature/source-control",
  ahead: 2,
  behind: 1,
  operation: "idle",
  generation: 7,
  snapshotId: "snapshot-7",
  totalChanges: changes.length,
  stagedChanges: 1,
  conflictedChanges: 1,
  nextCursor: null,
  hasMore: false,
  changes,
};

describe("SourceControlToolWindow", () => {
  it("groups repository changes and exposes branch divergence", () => {
    renderWindow();

    expect(screen.getByText("feature/source-control")).toBeVisible();
    expect(screen.getByText("origin/feature/source-control")).toBeVisible();
    expect(screen.getByText("↑2 ↓1")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Staged Changes" })).getByText("staged.ets")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Changes" })).getByText("local.ets")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Untracked Files" })).getByText("new.ets")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Conflicts" })).getByText("conflict.ets")).toBeVisible();
  });

  it("paginates large change lists without offering an incomplete stage-all action", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow({
      snapshot: { ...snapshot, totalChanges: 800, nextCursor: "4", hasMore: true },
    });

    expect(screen.getByText("4 of 800 changes loaded")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stage All" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load More (4/800)" }));
    expect(callbacks.onLoadMoreChanges).toHaveBeenCalledOnce();
  });

  it("opens diffs, stages files, and opens a file on double click", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow();
    const localFile = screen.getByTitle("src/local.ets");

    await user.click(localFile);
    expect(callbacks.onOpenDiff).toHaveBeenCalledWith({ entry: changes[1], staged: false });

    await user.click(screen.getByRole("button", { name: "Stage src/local.ets" }));
    expect(callbacks.onStage).toHaveBeenCalledWith(changes[1]);

    fireEvent.doubleClick(localFile);
    expect(callbacks.onOpenFile).toHaveBeenCalledWith("/workspace/src/local.ets");
  });

  it("offers IDE change actions from the row context menu", async () => {
    const callbacks = renderWindow();
    fireEvent.contextMenu(screen.getByTitle("src/local.ets"), { clientX: 120, clientY: 90 });

    const menu = screen.getByRole("menu", { name: "Git actions: src/local.ets" });
    expect(within(menu).getByRole("menuitem", { name: "Open Changes" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Stage" })).toBeVisible();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Discard Changes..." }));
    expect(callbacks.discard.request).toHaveBeenCalledWith(changes[1]);
  });

  it("confirms a safe discard and exposes undo for the backup", async () => {
    const user = userEvent.setup();
    const discard = createDiscard({ pending: changes[1], backup: { commit: "abc", path: "src/local.ets" } });
    renderWindow({ discard });

    expect(screen.getByRole("dialog", { name: "Discard unstaged changes" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(discard.confirm).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(discard.restore).toHaveBeenCalledOnce();
  });

  it("shows affected unsaved files and can save before continuing", async () => {
    const user = userEvent.setup();
    const dirtyGuard = createDirtyGuard({
      pending: { actionLabel: "Pull remote changes", paths: null, dirtyPaths: ["/workspace/src/local.ets"] },
    });
    renderWindow({ dirtyGuard });

    const dialog = screen.getByRole("dialog", { name: "Save files before Git changes them?" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText("local.ets")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save All and Continue" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Save All and Continue" }));
    expect(dirtyGuard.saveAndContinue).toHaveBeenCalledOnce();
  });

  it("requires staged changes and a message before committing", async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    const cleanSnapshot = snapshotWithoutConflicts();
    const { rerender } = renderSourceControl(callbacks, { snapshot: cleanSnapshot, commitDraft: { message: "", amend: false, signOff: false } });
    const commit = screen.getByRole("button", { name: "Commit (1)" });

    expect(commit).toBeDisabled();
    await user.type(screen.getByLabelText("Commit message"), "Describe change");
    expect(callbacks.onChangeCommitMessage).toHaveBeenCalled();

    rerender(sourceControlElement(callbacks, { snapshot: cleanSnapshot, commitDraft: { message: "Describe change", amend: false, signOff: false } }));
    await user.click(screen.getByRole("button", { name: "Commit (1)" }));
    expect(callbacks.onCommit).toHaveBeenCalledWith("commit");
  });

  it("offers amend, sign-off, and commit-and-push without hiding commit readiness", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow({ snapshot: snapshotWithoutConflicts(), commitDraft: { message: "Describe change", amend: false, signOff: false } });

    await user.click(screen.getByRole("checkbox", { name: "Amend" }));
    await user.click(screen.getByRole("checkbox", { name: "Sign-off" }));
    expect(callbacks.onChangeCommitAmend).toHaveBeenCalledWith(true);
    expect(callbacks.onChangeCommitSignOff).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "More commit actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Commit and Push" }));
    expect(callbacks.onCommit).toHaveBeenCalledWith("commitAndPush");
  });

  it("keeps Stage All available when every change is untracked", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow({ snapshot: { ...snapshot, changes: [changes[2]] } });

    await user.click(within(screen.getByRole("region", { name: "Untracked Files" })).getByRole("button", { name: "Stage All" }));
    expect(callbacks.onStageAll).toHaveBeenCalledOnce();
  });

  it("runs remote commands from the repository header", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow();

    await user.click(screen.getByRole("button", { name: "Fetch" }));
    await user.click(screen.getByRole("button", { name: "Pull" }));
    await user.click(screen.getByRole("button", { name: "Push" }));

    expect(callbacks.onFetch).toHaveBeenCalledOnce();
    expect(callbacks.onPull).toHaveBeenCalledOnce();
    expect(callbacks.onPush).toHaveBeenCalledOnce();
  });

  it("switches to a keyboard-ready paginated commit log", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow();

    await user.click(screen.getByRole("tab", { name: "Log" }));

    expect(callbacks.history.loadInitial).toHaveBeenCalled();
    expect(screen.getByRole("option", { name: /Improve Source Control workflow/ })).toBeVisible();
    await user.click(screen.getByRole("option", { name: /Improve Source Control workflow/ }));
    expect(callbacks.history.selectCommit).toHaveBeenCalledWith(callbacks.history.commits[0]);
  });

  it("returns to Changes when a history action enters conflict resolution", async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    const { rerender } = renderSourceControl(callbacks, {});
    await user.click(screen.getByRole("tab", { name: "Log" }));

    rerender(sourceControlElement(callbacks, { snapshot: { ...snapshot, operation: "cherryPick" } }));

    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Cherry-pick in progress" })).toBeVisible();
  });

  it("manages Git-compatible stashes from a dedicated view", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow();
    await user.click(screen.getByRole("tab", { name: "Stashes" }));

    const stashRow = screen.getByRole("listitem", { name: "stash@{0}: On main: Refine navigation" });
    expect(stashRow).toBeVisible();
    await user.click(within(stashRow).getByRole("button", { name: /Refine navigation/ }));
    expect(callbacks.stash.openDiff).toHaveBeenCalledWith(callbacks.stash.entries[0]);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(callbacks.stash.apply).toHaveBeenCalledWith(callbacks.stash.entries[0]);

    await user.click(screen.getByRole("button", { name: "Drop stash@{0}" }));
    expect(callbacks.stash.requestDrop).toHaveBeenCalledWith(callbacks.stash.entries[0]);
  });

  it("requires confirmation before dropping a stash", async () => {
    const user = userEvent.setup();
    const stash = createStash();
    stash.pendingDrop = stash.entries[0];
    renderWindow({ stash });
    await user.click(screen.getByRole("tab", { name: "Stashes" }));
    expect(screen.getByRole("dialog", { name: "Drop Stash" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Drop Stash" }));
    expect(stash.confirmDrop).toHaveBeenCalledOnce();
  });

  it("creates a stash with explicit working-tree options", async () => {
    const user = userEvent.setup();
    const stash = createStash({ createOpen: true });
    renderWindow({ stash });
    await user.click(screen.getByRole("tab", { name: "Stashes" }));
    const dialog = screen.getByRole("dialog", { name: "Stash Changes" });
    await user.type(within(dialog).getByRole("textbox", { name: "Stash message" }), "Pause editor work");
    await user.click(within(dialog).getByRole("checkbox", { name: "Keep staged changes in the working tree" }));
    await user.click(within(dialog).getByRole("button", { name: "Stash Changes" }));
    expect(stash.create).toHaveBeenCalledWith("Pause editor work", true, true);
  });

  it("opens conflicted files in the resolver and guards operation abort", async () => {
    const user = userEvent.setup();
    const callbacks = renderWindow({ snapshot: { ...snapshot, operation: "merge" } });

    await user.click(screen.getByTitle("src/conflict.ets"));
    expect(callbacks.conflict.open).toHaveBeenCalledWith(changes[3]);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Abort..." }));
    await user.click(screen.getByRole("button", { name: "Abort" }));
    expect(callbacks.conflict.abortOperation).toHaveBeenCalledOnce();
  });

  it("builds and applies an editable three-way conflict result", async () => {
    const user = userEvent.setup();
    const conflict = createConflict();
    conflict.path = "src/conflict.ets";
    conflict.content = {
      relativePath: "src/conflict.ets",
      base: { exists: true, binary: false, content: "base\n" },
      current: { exists: true, binary: false, content: "current\n" },
      incoming: { exists: true, binary: false, content: "incoming\n" },
      result: "markers\n",
      binary: false,
    };
    renderWindow({ conflict });

    expect(await screen.findByRole("dialog", { name: "Resolve conflict: src/conflict.ets" })).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Accept Both" }));
    const resultEditor = screen.getByLabelText("Resolved content");
    expect(resultEditor).toHaveValue("current\nincoming\n");
    fireEvent.change(resultEditor, { target: { value: "resolved\n" } });
    await user.click(screen.getByRole("button", { name: "Save & Mark Resolved" }));
    expect(conflict.resolve).toHaveBeenCalledWith("content", "resolved\n");
  });

  it("blocks resolution until conflict markers are removed", async () => {
    const user = userEvent.setup();
    const conflict = createConflict();
    conflict.path = "src/conflict.ets";
    conflict.content = {
      relativePath: "src/conflict.ets",
      base: { exists: true, binary: false, content: "base\n" },
      current: { exists: true, binary: false, content: "current\n" },
      incoming: { exists: true, binary: false, content: "incoming\n" },
      result: "<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> feature\n",
      binary: false,
    };
    renderWindow({ conflict });

    expect(await screen.findByRole("dialog", { name: "Resolve conflict: src/conflict.ets" })).toBeVisible();
    expect(await screen.findByText("1 unresolved conflict")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save & Mark Resolved" })).toBeDisabled();
    expect(screen.getByText("Conflict 1 / 1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Accept Current Conflict" }));
    expect(screen.getByText("Ready to mark resolved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save & Mark Resolved" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Show Base" }));
    expect(screen.getByRole("region", { name: "Base" })).toBeVisible();
  });

  it("navigates multiple conflict blocks with F7 and Shift+F7", async () => {
    const conflict = createConflict();
    conflict.path = "src/conflict.ets";
    conflict.content = {
      relativePath: "src/conflict.ets",
      base: { exists: true, binary: false, content: "base\n" },
      current: { exists: true, binary: false, content: "current\n" },
      incoming: { exists: true, binary: false, content: "incoming\n" },
      result: "<<<<<<< HEAD\none\n=======\ntwo\n>>>>>>> feature\ncontext\n<<<<<<< HEAD\nthree\n=======\nfour\n>>>>>>> feature\n",
      binary: false,
    };
    renderWindow({ conflict });
    const dialog = await screen.findByRole("dialog", { name: "Resolve conflict: src/conflict.ets" });

    expect(await screen.findByText("Conflict 1 / 2")).toBeVisible();
    fireEvent.keyDown(dialog, { key: "F7" });
    expect(screen.getByText("Conflict 2 / 2")).toBeVisible();
    fireEvent.keyDown(dialog, { key: "F7", shiftKey: true });
    expect(screen.getByText("Conflict 1 / 2")).toBeVisible();
  });
});

function renderWindow(overrides: Partial<React.ComponentProps<typeof SourceControlToolWindow>> = {}) {
  const callbacks = createCallbacks();
  renderSourceControl(callbacks, overrides);
  return callbacks;
}

function createCallbacks() {
  return {
    history: createHistory(),
    conflict: createConflict(),
    discard: createDiscard(),
    stash: createStash(),
    dirtyGuard: createDirtyGuard(),
    onChangeCommitMessage: vi.fn(),
    onChangeCommitAmend: vi.fn(),
    onChangeCommitSignOff: vi.fn(),
    onRefresh: vi.fn(),
    onLoadMoreChanges: vi.fn(),
    onCommit: vi.fn(),
    onFetch: vi.fn(),
    onPull: vi.fn(),
    onPush: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenFile: vi.fn(),
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onStageAll: vi.fn(),
    onUnstageAll: vi.fn(),
  };
}

function createDirtyGuard(overrides: Partial<GitWorkingTreeGuardController> = {}): GitWorkingTreeGuardController {
  return {
    pending: null,
    saving: false,
    error: null,
    ensureReady: vi.fn().mockResolvedValue(true),
    cancel: vi.fn(),
    saveAndContinue: vi.fn(),
    ...overrides,
  };
}

function createDiscard(overrides: Partial<SourceControlDiscardController> = {}): SourceControlDiscardController {
  return {
    pending: null,
    backup: null,
    discarding: false,
    restoring: false,
    request: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
    restore: vi.fn(),
    dismissBackup: vi.fn(),
    ...overrides,
  };
}

function createConflict(): SourceControlConflictController {
  return {
    path: null,
    content: null,
    loading: false,
    saving: false,
    error: null,
    open: vi.fn(),
    close: vi.fn(),
    resolve: vi.fn(),
    continueOperation: vi.fn(),
    abortOperation: vi.fn(),
  };
}

function createHistory(): GitHistoryController {
  return {
    commits: [{ commit: "abc1234567890", shortCommit: "abc1234", parents: [], refs: ["HEAD -> main"], subject: "Improve Source Control workflow", author: "Jane Doe", authorEmail: "jane@example.com", authoredAtEpochSeconds: 1785283200, graph: "*" }],
    status: "ready",
    loadingMore: false,
    hasMore: false,
    selectedCommit: null,
    details: null,
    detailsLoading: false,
    selectedFilePath: null,
    diffLoading: false,
    pendingAction: null,
    actionStatus: "idle",
    error: null,
    loadInitial: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    selectCommit: vi.fn(),
    selectCommitFile: vi.fn(),
    openCommitDiff: vi.fn(),
    openCommitFileDiff: vi.fn(),
    requestCommitAction: vi.fn(),
    cancelCommitAction: vi.fn(),
    confirmCommitAction: vi.fn(),
    copyCommitHash: vi.fn(),
    invalidate: vi.fn(),
  };
}

function createStash(overrides: Partial<GitStashController> = {}): GitStashController {
  const entry = { index: 0, reference: "stash@{0}", commit: "abc123", subject: "On main: Refine navigation", createdAtEpochSeconds: 1785283200 };
  return {
    entries: [entry],
    total: 1,
    hasMore: false,
    loaded: true,
    operation: "idle",
    error: null,
    createOpen: false,
    pendingDrop: null,
    selectedReference: null,
    refresh: vi.fn(),
    activate: vi.fn(),
    openDiff: vi.fn(),
    loadMore: vi.fn(),
    openCreate: vi.fn(),
    closeCreate: vi.fn(),
    create: vi.fn(),
    apply: vi.fn(),
    pop: vi.fn(),
    requestDrop: vi.fn(),
    cancelDrop: vi.fn(),
    confirmDrop: vi.fn(),
    ...overrides,
  };
}

function renderSourceControl(callbacks: ReturnType<typeof createCallbacks>, overrides: Partial<React.ComponentProps<typeof SourceControlToolWindow>>) {
  return render(sourceControlElement(callbacks, overrides));
}

function sourceControlElement(callbacks: ReturnType<typeof createCallbacks>, overrides: Partial<React.ComponentProps<typeof SourceControlToolWindow>>) {
  return (
    <SourceControlToolWindow
      snapshot={snapshot}
      selected={null}
      commitDraft={{ message: "Ready to commit", amend: false, signOff: false }}
      operation="idle"
      error={null}
      loadingMoreChanges={false}
      loadingAmendMessage={false}
      {...callbacks}
      {...overrides}
    />
  );
}

function change(
  relativePath: string,
  statusCode: string,
  kind: GitChangeEntry["kind"],
  flags: Partial<Pick<GitChangeEntry, "staged" | "unstaged" | "conflicted">>,
): GitChangeEntry {
  return {
    relativePath,
    absolutePath: `/workspace/${relativePath}`,
    statusCode,
    kind,
    originalPath: null,
    staged: false,
    unstaged: false,
    conflicted: false,
    ...flags,
  };
}

function snapshotWithoutConflicts(): GitRepositorySnapshot {
  const filtered = changes.filter((entry) => !entry.conflicted);
  return { ...snapshot, changes: filtered, totalChanges: filtered.length, conflictedChanges: 0 };
}
