import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

describe("editor navigation layout", () => {
  it("cancels ordinary session scroll restoration when an explicit jump arrives", () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(47);
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const appearance = defaultSettings().editor;
    const { rerender } = render(
      <ArkTsEditor appearance={appearance} path="/workspace/A.ets" value="A" onChange={() => undefined} />,
    );

    rerender(
      <ArkTsEditor
        appearance={appearance}
        path="/workspace/B.ets"
        value={"line 1\nline 2\nline 3"}
        selectionTarget={{ line: 3, column: 1, nonce: 1 }}
        onChange={() => undefined}
      />,
    );

    expect(cancelAnimationFrame).toHaveBeenCalledWith(47);
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
  });
});
