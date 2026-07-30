import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitBranchPicker } from "@/components/layout/GitBranchPicker";
import type { GitBranchPickerItem } from "@/components/layout/use-git-branch-controller";

const branch: GitBranchPickerItem = {
  name: "feature/git",
  displayName: "feature/git",
  kind: "local",
  current: false,
  favorite: false,
  upstream: "origin/feature/git",
  ahead: 1,
  behind: 0,
  group: "Recent",
};

describe("GitBranchPicker", () => {
  it("offers explicit dirty-worktree checkout strategies", async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    renderPicker(callbacks, { pendingCheckout: branch, workingTreeChangedFiles: 3 });

    expect(screen.getByRole("region", { name: "Branch checkout options" })).toHaveTextContent("3 changed files");
    await user.click(screen.getByRole("button", { name: "Keep Changes & Switch" }));
    await user.click(screen.getByRole("button", { name: "Smart Checkout" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(callbacks.onPreserveAndCheckout).toHaveBeenCalledOnce();
    expect(callbacks.onStashAndCheckout).toHaveBeenCalledOnce();
    expect(callbacks.onCancelPendingCheckout).toHaveBeenCalledOnce();
  });

  it("cancels only the preflight when Escape is pressed", () => {
    const callbacks = createCallbacks();
    renderPicker(callbacks, { pendingCheckout: branch });

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch Git Branch" }), { key: "Escape" });

    expect(callbacks.onCancelPendingCheckout).toHaveBeenCalledOnce();
    expect(callbacks.onClose).not.toHaveBeenCalled();
  });

  it("keeps keyboard and pointer branch selection available for a clean tree", async () => {
    const user = userEvent.setup();
    const callbacks = createCallbacks();
    renderPicker(callbacks);

    await user.click(screen.getByRole("option", { name: "feature/git origin/feature/git ↑1 ↓0" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch Git Branch" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch Git Branch" }), { key: "Enter" });

    expect(callbacks.onCheckout).toHaveBeenCalledWith(branch);
    expect(callbacks.onMoveSelection).toHaveBeenCalledWith(1);
    expect(callbacks.onCheckoutSelected).toHaveBeenCalledOnce();
  });
});

function renderPicker(callbacks: ReturnType<typeof createCallbacks>, overrides: Partial<React.ComponentProps<typeof GitBranchPicker>> = {}) {
  return render(
    <GitBranchPicker
      open
      currentBranch="main"
      query=""
      items={[branch]}
      selectedIndex={0}
      loading={false}
      switching={false}
      error={null}
      pendingCheckout={null}
      workingTreeChangedFiles={0}
      workingTreeConflictedFiles={0}
      onChangeQuery={callbacks.onChangeQuery}
      onSelectIndex={callbacks.onSelectIndex}
      onMoveSelection={callbacks.onMoveSelection}
      onCheckout={callbacks.onCheckout}
      onCheckoutSelected={callbacks.onCheckoutSelected}
      onCancelPendingCheckout={callbacks.onCancelPendingCheckout}
      onPreserveAndCheckout={callbacks.onPreserveAndCheckout}
      onStashAndCheckout={callbacks.onStashAndCheckout}
      onClose={callbacks.onClose}
      {...overrides}
    />,
  );
}

function createCallbacks() {
  return {
    onChangeQuery: vi.fn(),
    onSelectIndex: vi.fn(),
    onMoveSelection: vi.fn(),
    onCheckout: vi.fn(),
    onCheckoutSelected: vi.fn(),
    onCancelPendingCheckout: vi.fn(),
    onPreserveAndCheckout: vi.fn(),
    onStashAndCheckout: vi.fn(),
    onClose: vi.fn(),
  };
}
