import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GitHistoryView } from "@/components/layout/GitHistoryView";
import type { GitHistoryController } from "@/components/layout/use-git-history-controller";
import type { GitCommitDetails, GitCommitFile } from "@/features/git/git-history-model";

const files: GitCommitFile[] = [
  { status: "M", path: "src/first.ets", previousPath: null },
  { status: "A", path: "src/second.ets", previousPath: null },
];

const details: GitCommitDetails = {
  commit: "abcdef1234567890",
  shortCommit: "abcdef1",
  parents: ["parent"],
  author: "ArkLine",
  authorEmail: "arkline@example.invalid",
  authoredAtEpochSeconds: 1_785_283_200,
  subject: "Update files",
  body: "",
  files,
  filesTruncated: false,
};

describe("GitHistoryView", () => {
  it("selects changed files with the keyboard and opens the focused file diff", async () => {
    const user = userEvent.setup();
    const openCommitFileDiff = vi.fn().mockResolvedValue(undefined);
    render(<HistoryHarness openCommitFileDiff={openCommitFileDiff} confirmCommitAction={vi.fn()} />);

    const fileList = screen.getByRole("listbox", { name: "Changed files" });
    fileList.focus();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByRole("option", { name: "src/second.ets" })).toHaveAttribute("aria-selected", "true");
    expect(openCommitFileDiff).toHaveBeenCalledWith(files[1]);

    await user.click(screen.getByRole("option", { name: "src/first.ets" }));
    expect(openCommitFileDiff).toHaveBeenLastCalledWith(files[0]);
  });

  it("confirms commit actions from the details panel", async () => {
    const user = userEvent.setup();
    const confirmCommitAction = vi.fn().mockResolvedValue(undefined);
    render(<HistoryHarness openCommitFileDiff={vi.fn()} confirmCommitAction={confirmCommitAction} />);

    await user.click(screen.getByRole("button", { name: "Cherry-pick..." }));
    expect(screen.getByRole("dialog", { name: "Cherry-pick Commit" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cherry-pick" }));

    expect(confirmCommitAction).toHaveBeenCalledOnce();
  });
});

function HistoryHarness({ openCommitFileDiff, confirmCommitAction }: {
  openCommitFileDiff: (file: GitCommitFile) => Promise<void>;
  confirmCommitAction: () => Promise<void>;
}) {
  const [selectedFilePath, setSelectedFilePath] = useState(files[0].path);
  const [pendingAction, setPendingAction] = useState<"cherryPick" | "revert" | null>(null);
  const history = {
    commits: [],
    status: "ready",
    loadingMore: false,
    hasMore: false,
    selectedCommit: details.commit,
    details,
    detailsLoading: false,
    selectedFilePath,
    diffLoading: false,
    pendingAction,
    actionStatus: "idle",
    error: null,
    loadInitial: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    selectCommit: vi.fn(),
    selectCommitFile: (file: GitCommitFile) => setSelectedFilePath(file.path),
    openCommitDiff: vi.fn(),
    openCommitFileDiff,
    requestCommitAction: setPendingAction,
    cancelCommitAction: () => setPendingAction(null),
    confirmCommitAction,
    copyCommitHash: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as GitHistoryController;
  return <GitHistoryView history={history} />;
}
