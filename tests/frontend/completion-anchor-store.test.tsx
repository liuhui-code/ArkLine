import { act, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import { CompletionPopup } from "@/components/layout/CompletionPopup";
import { createCompletionAnchorStore } from "@/features/editor/completion-anchor-store";

describe("completion anchor store", () => {
  it("ignores duplicate caret measurements", () => {
    const store = createCompletionAnchorStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const anchor = measuredAnchor(4, 9);

    store.setAnchor(anchor);
    store.setAnchor({ ...anchor });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("updates the popup without rerendering its owner", () => {
    const store = createCompletionAnchorStore(measuredAnchor(2, 3));
    const ownerRender = vi.fn();

    function Owner() {
      ownerRender();
      return (
        <CompletionPopup
          items={[]}
          selectedIndex={0}
          anchorStore={store}
          status="empty"
          detailsVisible={false}
          onAccept={() => undefined}
          onSelect={() => undefined}
        />
      );
    }

    render(<Owner />);
    expect(screen.getByRole("status")).toHaveAttribute("data-anchor-line", "2");

    act(() => {
      store.setAnchor(measuredAnchor(8, 5));
    });

    expect(screen.getByRole("status")).toHaveAttribute("data-anchor-line", "8");
    expect(ownerRender).toHaveBeenCalledTimes(1);
  });

  it("can be consumed through React's external-store contract", () => {
    const store = createCompletionAnchorStore();

    function AnchorLine() {
      const anchor = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      return <span>{anchor?.line ?? 0}</span>;
    }

    render(<AnchorLine />);
    act(() => store.setAnchor(measuredAnchor(6, 2)));

    expect(screen.getByText("6")).toBeInTheDocument();
  });
});

function measuredAnchor(line: number, column: number) {
  return {
    left: 80,
    right: 81,
    top: 40,
    bottom: 60,
    line,
    column,
    measured: true,
  };
}
