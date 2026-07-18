import { Text } from "@codemirror/state";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

describe("editor Text sessions", () => {
  it("restores files without materializing full document strings", () => {
    const appearance = defaultSettings().editor;
    const documentA = Text.of(["struct A {}"]);
    const documentB = Text.of(["struct B {}"]);
    const toString = vi.spyOn(Text.prototype, "toString");
    const { rerender } = render(
      <ArkTsEditor appearance={appearance} path="C:/demo/A.ets" document={documentA} onChange={() => undefined} />,
    );
    toString.mockClear();

    rerender(
      <ArkTsEditor appearance={appearance} path="C:/demo/B.ets" document={documentB} onChange={() => undefined} />,
    );
    rerender(
      <ArkTsEditor appearance={appearance} path="C:/demo/A.ets" document={documentA} onChange={() => undefined} />,
    );

    expect(toString).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("struct A {}");
    toString.mockRestore();
  });
});
