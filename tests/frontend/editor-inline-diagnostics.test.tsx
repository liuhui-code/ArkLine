import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";
import type { ValidationProblem } from "@/features/workspace/workspace-api";

describe("editor inline diagnostics", () => {
  it("validates the latest unsaved document and marks the reported range", async () => {
    const user = userEvent.setup();
    const requests: Array<{ path: string; content: string }> = [];
    const results: Array<{ path: string; problems: ValidationProblem[] }> = [];
    const validate = async (path: string, content: string): Promise<ValidationProblem[]> => {
      requests.push({ path, content });
      const lines = content.split("\n");
      const lineIndex = lines.findIndex((line) => line.includes("console.log"));
      return lineIndex >= 0
        ? [{
            source: "lint",
            severity: "warning",
            path,
            line: lineIndex + 1,
            column: (lines[lineIndex]?.indexOf("console.log") ?? 0) + 1,
            message: "Remove console.log before committing",
          }]
        : [];
    };
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"struct Index {\n}\n// "}
        onChange={() => undefined}
        onValidationRequest={validate}
        onValidationResult={(path, problems) => results.push({ path, problems })}
      />,
    );

    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}console.log('draft')");

    await waitFor(() => {
      expect(requests).toEqual(expect.arrayContaining([expect.objectContaining({
        path: "C:/demo/main.ets",
        content: expect.stringContaining("console.log('draft')"),
      })]));
      expect(container.querySelector(".cm-lint-marker-warning")).not.toBeNull();
      expect(container.querySelector(".cm-lintRange-warning")).not.toBeNull();
      expect(results).toEqual(expect.arrayContaining([expect.objectContaining({
        path: "C:/demo/main.ets",
        problems: expect.arrayContaining([expect.objectContaining({ message: "Remove console.log before committing" })]),
      })]));
    }, { timeout: 4_000 });
  });

  it("does not display an async diagnostic produced for an older document snapshot", async () => {
    const user = userEvent.setup();
    let resolveOld!: (problems: ValidationProblem[]) => void;
    const requests: Array<{ path: string; content: string }> = [];
    const validate = (path: string, content: string): Promise<ValidationProblem[]> => {
      requests.push({ path, content });
      if (content.includes("console.log('old')")) {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve([]);
    };
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"console.log('old')\n"}
        onChange={() => undefined}
        onValidationRequest={validate}
      />,
    );

    await waitFor(() => expect(requests).toHaveLength(1), { timeout: 3_000 });
    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}const clean = true");
    act(() => resolveOld([{
      source: "lint",
      severity: "warning",
      path: "C:/demo/main.ets",
      line: 1,
      column: 1,
      message: "Old diagnostic",
    }]));

    await waitFor(() => {
      expect(requests).toEqual(expect.arrayContaining([expect.objectContaining({
        path: "C:/demo/main.ets",
        content: expect.stringContaining("clean = true"),
      })]));
      expect(container.querySelector(".cm-lint-marker-warning")).toBeNull();
      expect(container.querySelector(".cm-lintRange-warning")).toBeNull();
    }, { timeout: 4_000 });
  });

  it("applies a safe diagnostic fix to the unsaved document and keeps it undoable", async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    const validate = async (path: string): Promise<ValidationProblem[]> => [{
      source: "format",
      severity: "warning",
      path,
      line: 1,
      column: 1,
      message: "Replace tabs with spaces",
      fix: {
        title: "Replace tab with spaces",
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2,
        replacement: "  ",
      },
    }];
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"\tlet value = 1\n"}
        onChange={(content) => changes.push(content)}
        onValidationRequest={validate}
      />,
    );

    await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-lint-marker-warning");
      expect(element).not.toBeNull();
    }, { timeout: 3_000 });
    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    fireEvent.keyDown(editor, { key: "Enter", altKey: true });

    expect(screen.getByLabelText("Editor Content")).toHaveTextContent("let value = 1");
    expect(changes.at(-1)).toBe("  let value = 1\n");

    await user.click(screen.getByLabelText("Editor Content"));
    await user.keyboard("{Control>}z{/Control}");
    expect(changes.at(-1)).toBe("\tlet value = 1\n");
  });

  it("refuses a diagnostic fix when the reported text changed before application", async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    const validate = async (path: string): Promise<ValidationProblem[]> => [{
      source: "format",
      severity: "warning",
      path,
      line: 1,
      column: 1,
      message: "Replace tabs with spaces",
      fix: {
        title: "Replace tab with spaces",
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2,
        replacement: "  ",
      },
    }];
    const { container } = render(
      <ArkTsEditor
        appearance={defaultSettings().editor}
        path="C:/demo/main.ets"
        value={"\tlet value = 1\n"}
        onChange={(content) => changes.push(content)}
        onValidationRequest={validate}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".cm-lint-marker-warning")).not.toBeNull();
    }, { timeout: 3_000 });
    const editor = screen.getByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{Home}{/Control}{Delete}x");
    fireEvent.keyDown(editor, { key: "Enter", altKey: true });

    expect(changes.at(-1)).toBe("xlet value = 1\n");
  });
});
