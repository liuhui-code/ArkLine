import { act, render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { readFileSync } from "node:fs";
import { GitConflictCodeEditor } from "@/components/layout/GitConflictCodeEditor";

const appCss = readFileSync("src/styles/app.css", "utf8");
let appStyleElement: HTMLStyleElement;

beforeAll(() => {
  appStyleElement = document.createElement("style");
  appStyleElement.textContent = extractStyleRules([
    ".git-conflict-code-editor",
    ".git-conflict-code-editor > .cm-editor",
    ".git-conflict-code-editor .cm-scroller",
  ]).join("\n");
  document.head.append(appStyleElement);
});

afterAll(() => {
  appStyleElement.remove();
});

it("keeps long conflict documents inside a vertically scrollable editor", () => {
  const value = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
  const { container } = render(
    <GitConflictCodeEditor
      ariaLabel="Current conflict version"
      value={value}
      original="base\n"
      relativePath="src/main.ets"
      readOnly
    />,
  );

  const content = screen.getByLabelText("Current conflict version");
  const host = container.querySelector(".git-conflict-code-editor") as HTMLElement;
  const scroller = content.closest(".cm-scroller") as HTMLElement;
  expect(host).toBeInstanceOf(HTMLElement);
  expect(scroller).toBeInstanceOf(HTMLElement);
  expect(window.getComputedStyle(host).overflow).toBe("hidden");
  expect(window.getComputedStyle(scroller).overflow).toBe("auto");
});

it("publishes local edits and accepts an explicit external replacement", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <GitConflictCodeEditor ariaLabel="Resolved content" value="initial\n" original="base\n" relativePath="src/main.ets" readOnly={false} onChange={onChange} />,
  );
  const content = screen.getByLabelText("Resolved content");
  const view = EditorView.findFromDOM(content);
  expect(view).not.toBeNull();

  act(() => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: "local edit\n" } }));
  expect(onChange).toHaveBeenLastCalledWith("local edit\n");

  rerender(<GitConflictCodeEditor ariaLabel="Resolved content" value="external edit\n" original="base\n" relativePath="src/main.ets" readOnly={false} onChange={onChange} />);
  expect(screen.getByLabelText("Resolved content")).toHaveTextContent("external edit");
});

function extractStyleRules(targetSelectors: string[]) {
  return [...appCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter((match) => {
      const selectors = match[1].split(",").map((selector) => selector.trim());
      return targetSelectors.some((targetSelector) => selectors.includes(targetSelector));
    })
    .map((match) => `${match[1]} {${match[2]}}`);
}
