import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SearchSessionQueryInput } from "@/components/layout/SearchSessionQueryInput";

describe("SearchSessionQueryInput", () => {
  it("keeps rapid typing local, cancels stale work immediately, and commits once", () => {
    vi.useFakeTimers();
    const onDraftChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <SearchSessionQueryInput
        label="Search Everywhere Query"
        mode="searchEverywhere"
        query=""
        placeholder="Search"
        onDraftChange={onDraftChange}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByLabelText("Search Everywhere Query");

    for (const value of ["e", "en", "ent", "entr", "entry", "entr", "entryAbility"]) {
      fireEvent.change(input, { target: { value } });
    }

    expect(input).toHaveValue("entryAbility");
    expect(onDraftChange).toHaveBeenCalledTimes(7);
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(119));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("entryAbility");
    vi.useRealTimers();
  });

  it("uses the longer content-search debounce window", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(
      <SearchSessionQueryInput
        label="Content Search Query"
        mode="find"
        query=""
        placeholder="Search"
        onDraftChange={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Content Search Query"), {
      target: { value: "Entry" },
    });
    act(() => vi.advanceTimersByTime(249));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledWith("Entry");
    vi.useRealTimers();
  });

  it("cancels a pending commit when the palette closes", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const { unmount } = render(
      <SearchSessionQueryInput
        label="Search Everywhere Query"
        mode="searchEverywhere"
        query=""
        placeholder="Search"
        onDraftChange={vi.fn()}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search Everywhere Query"), { target: { value: "Entry" } });
    unmount();
    act(() => vi.advanceTimersByTime(200));

    expect(onCommit).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
