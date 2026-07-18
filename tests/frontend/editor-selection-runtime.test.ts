import { describe, expect, it } from "vitest";
import { createEditorSelectionRuntime } from "@/features/editor/editor-selection-runtime";

describe("editor selection runtime", () => {
  it("keeps a stable selection object while columns change", () => {
    const runtime = createEditorSelectionRuntime();
    const selection = runtime.selection;
    let rootUpdates = 0;

    for (let column = 2; column <= 101; column += 1) {
      const update = runtime.update({ line: 1, column });
      if (update.lineChanged || update.selectedTextChanged) rootUpdates += 1;
    }

    expect(runtime.selection).toBe(selection);
    expect(selection).toEqual({ line: 1, column: 101 });
    expect(rootUpdates).toBe(0);
  });

  it("notifies external subscribers only for line and selected-text changes", () => {
    const runtime = createEditorSelectionRuntime();
    let notifications = 0;
    runtime.subscribe(() => {
      notifications += 1;
    });

    expect(runtime.update({ line: 2, column: 1 })).toEqual({
      lineChanged: true,
      selectedTextChanged: false,
    });
    expect(runtime.update({ line: 2, column: 4, selectedText: "name" })).toEqual({
      lineChanged: false,
      selectedTextChanged: true,
    });
    runtime.update({ line: 2, column: 8, selectedText: "name" });

    expect(notifications).toBe(2);
    expect(runtime.getSnapshot()).toEqual({ line: 2, column: 8, selectedText: "name" });
  });
});
