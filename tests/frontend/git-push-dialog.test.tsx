import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitPushDialog } from "@/components/layout/GitPushDialog";
import type { GitPushController } from "@/components/layout/use-git-push-controller";

const commit = { commit: "abcdef123456", shortCommit: "abcdef1", parents: [], author: "Lin", authoredAtEpochSeconds: 1, subject: "Polish Commit workflow", refs: [], graph: "*" };

describe("Push Commits dialog", () => {
  it("previews the complete outgoing chain and pushes it", async () => {
    const user = userEvent.setup();
    const push = controller();
    render(<GitPushDialog push={push} />);

    expect(screen.getByRole("dialog", { name: "Push Commits" })).toBeVisible();
    expect(screen.getByRole("option", { name: /Polish Commit workflow/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("1 outgoing")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Push 1 Commit" }));
    expect(push.push).toHaveBeenCalledOnce();
  });

  it("offers safe recovery after a rejected push", async () => {
    const user = userEvent.setup();
    const push = controller({ recoveryNeeded: true, error: "Push rejected because the remote branch has newer commits." });
    render(<GitPushDialog push={push} />);

    await user.click(screen.getByRole("button", { name: "Update with Rebase" }));
    expect(push.updateAndPush).toHaveBeenCalledWith("rebase");
    await user.click(screen.getByRole("button", { name: "Force Push…" }));
    expect(screen.getByRole("button", { name: "Confirm Force Push" })).toBeVisible();
  });
});

function controller(overrides: Partial<GitPushController> = {}): GitPushController {
  return {
    visible: true, preview: { rootPath: "/workspace", repositoryRoot: "/workspace", localBranch: "feature/git-ui", remote: "origin", remoteBranch: "feature/git-ui", hasUpstream: true, totalCommits: 1, commitsTruncated: false, commits: [commit] },
    selectedCommit: commit.commit, details: null, loading: false, pushing: false, error: null, recoveryNeeded: false,
    open: vi.fn(), close: vi.fn(), refresh: vi.fn(), selectCommit: vi.fn(), push: vi.fn(), forcePush: vi.fn(), updateAndPush: vi.fn(), ...overrides,
  } as GitPushController;
}
