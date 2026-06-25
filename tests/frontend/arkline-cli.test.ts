import { describe, expect, it } from "vitest";

// @ts-ignore The CLI parser is a Node ESM helper.
import { parseArklineCliArgs } from "../../scripts/arkline-cli/cli-parser.mjs";

describe("arkline cli parser", () => {
  it("parses language inspect json requests", () => {
    expect(parseArklineCliArgs(["language", "inspect", "--json"])).toEqual({
      ok: true,
      command: {
        area: "language",
        name: "inspect",
        output: "json",
        dryRun: true,
      },
    });
  });

  it("parses language completion position requests", () => {
    expect(
      parseArklineCliArgs([
        "language",
        "completion",
        "--workspace",
        ".",
        "--file",
        "src/main.ets",
        "--line",
        "1",
        "--column",
        "1",
        "--json",
      ]),
    ).toEqual({
      ok: true,
      command: {
        area: "language",
        name: "completion",
        workspace: ".",
        file: "src/main.ets",
        line: 1,
        column: 1,
        output: "json",
        dryRun: true,
      },
    });
  });

  it("parses actions list position requests", () => {
    expect(
      parseArklineCliArgs([
        "actions",
        "list",
        "--workspace",
        ".",
        "--file",
        "src/main.ets",
        "--line",
        "1",
        "--column",
        "1",
        "--json",
      ]),
    ).toEqual({
      ok: true,
      command: {
        area: "actions",
        name: "list",
        workspace: ".",
        file: "src/main.ets",
        line: 1,
        column: 1,
        output: "json",
        dryRun: true,
      },
    });
  });

  it("defaults edit-producing commands to dry run unless apply is present", () => {
    expect(parseArklineCliArgs(["actions", "resolve", "--id", "workspace.renameFile", "--json"])).toEqual({
      ok: true,
      command: {
        area: "actions",
        name: "resolve",
        id: "workspace.renameFile",
        output: "json",
        dryRun: true,
      },
    });

    expect(parseArklineCliArgs(["actions", "resolve", "--id", "workspace.renameFile", "--apply", "--json"])).toEqual({
      ok: true,
      command: {
        area: "actions",
        name: "resolve",
        id: "workspace.renameFile",
        output: "json",
        dryRun: false,
      },
    });
  });

  it("returns ok false and an error for invalid input", () => {
    expect(parseArklineCliArgs(["language", "completion", "--workspace", "."])).toEqual({
      ok: false,
      error: "language completion requires --workspace, --file, --line, --column, and --json",
    });
  });
});
