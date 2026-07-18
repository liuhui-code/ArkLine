import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { LazyArkTsEditor } from "@/editor/LazyArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

const recordRenderPressure = vi.hoisted(() => vi.fn());

vi.mock("@/features/performance/use-ui-latency-monitor", () => ({ recordRenderPressure }));

describe("lazy editor render boundary", () => {
  it("does not render CodeMirror again when only callback identities change", async () => {
    const appearance = defaultSettings().editor;
    const { rerender } = render(
      <LazyArkTsEditor
        appearance={appearance}
        path="/workspace/Entry.ets"
        value="@Entry\nstruct Entry {}"
        onChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );
    await screen.findByLabelText("Editor Content");
    const initialCount = editorRenderCount();

    rerender(
      <LazyArkTsEditor
        appearance={appearance}
        path="/workspace/Entry.ets"
        value="@Entry\nstruct Entry {}"
        onChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    expect(editorRenderCount()).toBe(initialCount);
  });

  it("renders CodeMirror when document data changes", async () => {
    const appearance = defaultSettings().editor;
    const { rerender } = render(
      <LazyArkTsEditor
        appearance={appearance}
        path="/workspace/Entry.ets"
        value="@Entry\nstruct Entry {}"
        onChange={() => undefined}
      />,
    );
    await screen.findByLabelText("Editor Content");
    const initialCount = editorRenderCount();

    rerender(
      <LazyArkTsEditor
        appearance={appearance}
        path="/workspace/Entry.ets"
        value="@Entry\nstruct Entry { build() {} }"
        onChange={() => undefined}
      />,
    );

    expect(editorRenderCount()).toBeGreaterThan(initialCount);
  });
});

function editorRenderCount() {
  return recordRenderPressure.mock.calls.filter(([label]) => label === "Editor/ArkTsEditor").length;
}
