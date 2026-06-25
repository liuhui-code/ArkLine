import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

// @ts-ignore The CLI entrypoint is a Node ESM script.
import { buildSemanticRequest, main } from "../../scripts/arkline-cli.mjs";
// @ts-ignore The CLI parser is a Node ESM helper.
import { parseArklineCliArgs } from "../../scripts/arkline-cli/cli-parser.mjs";
// @ts-ignore The semantic client is a Node ESM helper.
import { SemanticWorkerClient } from "../../scripts/arkline-cli/semantic-client.mjs";
// @ts-ignore The workspace edit runtime is a Node ESM helper.
import { runWorkspaceEditCommand } from "../../scripts/arkline-cli/workspace-edit-runtime.mjs";

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

  it("parses generate page and component edit commands", () => {
    expect(
      parseArklineCliArgs([
        "generate",
        "page",
        "--workspace",
        ".",
        "--name",
        "Home",
        "--dry-run",
        "--json",
      ]),
    ).toEqual({
      ok: true,
      command: {
        area: "generate",
        name: "page",
        workspace: ".",
        symbolName: "Home",
        output: "json",
        dryRun: true,
      },
    });

    expect(
      parseArklineCliArgs([
        "generate",
        "component",
        "--workspace",
        ".",
        "--name",
        "UserCard",
        "--apply",
        "--json",
      ]),
    ).toEqual({
      ok: true,
      command: {
        area: "generate",
        name: "component",
        workspace: ".",
        symbolName: "UserCard",
        output: "json",
        dryRun: false,
      },
    });
  });

  it("rejects invalid generate names before plan generation", () => {
    for (const [kind, invalidName] of [
      ["page", "主页"],
      ["page", "../Escape"],
      ["component", "User-Card"],
    ]) {
      expect(
        parseArklineCliArgs([
          "generate",
          kind,
          "--workspace",
          ".",
          "--name",
          invalidName,
          "--dry-run",
          "--json",
        ]),
      ).toEqual({
        ok: false,
        error: "--name requires an ASCII ArkTS identifier",
      });
    }
  });

  it("parses rename-file edit commands", () => {
    expect(
      parseArklineCliArgs([
        "rename-file",
        "--workspace",
        ".",
        "--file",
        "src/pages/Old.ets",
        "--to",
        "src/pages/New.ets",
        "--dry-run",
        "--json",
      ]),
    ).toEqual({
      ok: true,
      command: {
        area: "rename-file",
        name: "workspace",
        workspace: ".",
        file: "src/pages/Old.ets",
        to: "src/pages/New.ets",
        output: "json",
        dryRun: true,
      },
    });
  });

  it("allows pretty output for workspace edit commands", () => {
    expect(
      parseArklineCliArgs([
        "generate",
        "page",
        "--workspace",
        ".",
        "--name",
        "Home",
        "--dry-run",
        "--pretty",
      ]),
    ).toEqual({
      ok: true,
      command: {
        area: "generate",
        name: "page",
        workspace: ".",
        symbolName: "Home",
        output: "pretty",
        dryRun: true,
      },
    });

    expect(
      parseArklineCliArgs([
        "rename-file",
        "--workspace",
        ".",
        "--file",
        "src/pages/Old.ets",
        "--to",
        "src/pages/New.ets",
        "--apply",
        "--pretty",
      ]),
    ).toEqual({
      ok: true,
      command: {
        area: "rename-file",
        name: "workspace",
        workspace: ".",
        file: "src/pages/Old.ets",
        to: "src/pages/New.ets",
        output: "pretty",
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

  it("rejects pretty output for semantic worker commands", () => {
    expect(parseArklineCliArgs(["language", "inspect", "--pretty"])).toEqual({
      ok: false,
      error: "language inspect does not support --pretty yet; use --json",
    });
  });
});

describe("arkline cli runtime dispatch", () => {
  it("dispatches actions resolve to the semantic worker", () => {
    expect(
      buildSemanticRequest({
        area: "actions",
        name: "resolve",
        id: "workspace.renameFile",
        output: "json",
        dryRun: true,
      }),
    ).toEqual({
      id: "actions-resolve-1",
      method: "resolveCodeAction",
      action: { id: "workspace.renameFile" },
    });
  });
});

describe("arkline cli workspace edit runtime", () => {
  it("returns a page WorkspaceEditPlan on dry run without writing", async () => {
    const workspace = createTempWorkspace();

    const result = await runWorkspaceEditCommand({
      area: "generate",
      name: "page",
      workspace,
      symbolName: "Home",
      output: "json",
      dryRun: true,
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        id: "generate.page.Home",
        title: "Generate page Home",
        operations: [
          {
            kind: "createFile",
            path: "src/pages/Home.ets",
            content: expect.stringContaining("struct Home"),
            overwrite: false,
          },
        ],
        conflicts: [],
        affectedFiles: ["src/pages/Home.ets"],
        undoLabel: "Remove generated page Home",
        requiresPreview: true,
      },
      dryRun: true,
    });
    expect(fs.existsSync(path.join(workspace, "src/pages/Home.ets"))).toBe(false);
  });

  it("applies a page WorkspaceEditPlan inside the workspace", async () => {
    const workspace = createTempWorkspace();

    const result = await runWorkspaceEditCommand({
      area: "generate",
      name: "page",
      workspace,
      symbolName: "Home",
      output: "json",
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      applied: true,
      conflicts: [],
      changedFiles: ["src/pages/Home.ets"],
    });
    expect(fs.readFileSync(path.join(workspace, "src/pages/Home.ets"), "utf8")).toBe(
      [
        "@Entry",
        "@Component",
        "struct Home {",
        "  build() {",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("applies a component WorkspaceEditPlan inside the workspace", async () => {
    const workspace = createTempWorkspace();

    const result = await runWorkspaceEditCommand({
      area: "generate",
      name: "component",
      workspace,
      symbolName: "UserCard",
      output: "json",
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      applied: true,
      conflicts: [],
      changedFiles: ["src/components/UserCard.ets"],
    });
    expect(fs.readFileSync(path.join(workspace, "src/components/UserCard.ets"), "utf8")).toBe(
      [
        "@Component",
        "struct UserCard {",
        "  build() {",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("returns a rename WorkspaceEditPlan on dry run without writing", async () => {
    const workspace = createTempWorkspace();
    const oldPath = path.join(workspace, "src/pages/Old.ets");
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, "old");

    const result = await runWorkspaceEditCommand({
      area: "rename-file",
      name: "workspace",
      workspace,
      file: "src/pages/Old.ets",
      to: "src/pages/New.ets",
      output: "json",
      dryRun: true,
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        id: "rename-file.src/pages/Old.ets",
        title: "Rename src/pages/Old.ets to src/pages/New.ets",
        operations: [
          {
            kind: "renameFile",
            oldPath: "src/pages/Old.ets",
            newPath: "src/pages/New.ets",
            overwrite: false,
          },
        ],
        conflicts: [],
        affectedFiles: ["src/pages/Old.ets", "src/pages/New.ets"],
        undoLabel: "Rename src/pages/New.ets back to src/pages/Old.ets",
        requiresPreview: true,
      },
      dryRun: true,
    });
    expect(fs.existsSync(oldPath)).toBe(true);
    expect(fs.existsSync(path.join(workspace, "src/pages/New.ets"))).toBe(false);
  });

  it("applies a rename WorkspaceEditPlan inside the workspace", async () => {
    const workspace = createTempWorkspace();
    const oldPath = path.join(workspace, "src/pages/Old.ets");
    const newPath = path.join(workspace, "src/pages/New.ets");
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, "old");

    const result = await runWorkspaceEditCommand({
      area: "rename-file",
      name: "workspace",
      workspace,
      file: "src/pages/Old.ets",
      to: "src/pages/New.ets",
      output: "json",
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      applied: true,
      conflicts: [],
      changedFiles: ["src/pages/New.ets"],
    });
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.readFileSync(newPath, "utf8")).toBe("old");
  });

  it("rejects output paths outside the workspace root", async () => {
    const workspace = createTempWorkspace();

    const result = await runWorkspaceEditCommand({
      area: "generate",
      name: "page",
      workspace,
      symbolName: "../../../Escape",
      output: "json",
      dryRun: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "Workspace edit has conflicts",
      payload: {
        applied: false,
        conflicts: [
          {
            path: "src/pages/../../../Escape.ets",
            message: "Path must stay inside the workspace root.",
          },
        ],
        changedFiles: [],
      },
      dryRun: false,
    });
    expect(fs.existsSync(path.join(workspace, "Escape.ets"))).toBe(false);
  });

  it("refuses to overwrite generated files by default", async () => {
    const workspace = createTempWorkspace();
    const targetPath = path.join(workspace, "src/pages/Home.ets");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "existing");

    const result = await runWorkspaceEditCommand({
      area: "generate",
      name: "page",
      workspace,
      symbolName: "Home",
      output: "json",
      dryRun: false,
    });

    expect(result).toMatchObject({
      ok: false,
      payload: {
        applied: false,
        conflicts: [
          {
            path: "src/pages/Home.ets",
            message: "Create file target already exists.",
          },
        ],
        changedFiles: [],
      },
      dryRun: false,
    });
    expect(fs.readFileSync(targetPath, "utf8")).toBe("existing");
  });

  it("refuses rename target collisions by default", async () => {
    const workspace = createTempWorkspace();
    const oldPath = path.join(workspace, "src/pages/Old.ets");
    const newPath = path.join(workspace, "src/pages/New.ets");
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, "old");
    fs.writeFileSync(newPath, "new");

    const result = await runWorkspaceEditCommand({
      area: "rename-file",
      name: "workspace",
      workspace,
      file: "src/pages/Old.ets",
      to: "src/pages/New.ets",
      output: "json",
      dryRun: false,
    });

    expect(result).toMatchObject({
      ok: false,
      payload: {
        applied: false,
        conflicts: [
          {
            path: "src/pages/New.ets",
            message: "Rename target already exists.",
          },
        ],
        changedFiles: [],
      },
      dryRun: false,
    });
    expect(fs.readFileSync(oldPath, "utf8")).toBe("old");
    expect(fs.readFileSync(newPath, "utf8")).toBe("new");
  });

  it("rejects blocked workspace directories by default", async () => {
    const workspace = createTempWorkspace();
    const oldPath = path.join(workspace, "src/pages/Old.ets");
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, "old");

    const result = await runWorkspaceEditCommand({
      area: "rename-file",
      name: "workspace",
      workspace,
      file: "src/pages/Old.ets",
      to: "node_modules/New.ets",
      output: "json",
      dryRun: false,
    });

    expect(result).toMatchObject({
      ok: false,
      payload: {
        applied: false,
        conflicts: [
          {
            path: "node_modules/New.ets",
            message: "Path is inside a blocked directory: node_modules.",
          },
        ],
        changedFiles: [],
      },
      dryRun: false,
    });
    expect(fs.existsSync(oldPath)).toBe(true);
    expect(fs.existsSync(path.join(workspace, "node_modules/New.ets"))).toBe(false);
  });
});

describe("arkline cli workspace edit output", () => {
  it("prints JSON for dry-run edit commands without starting the semantic worker", async () => {
    const workspace = createTempWorkspace();
    const writes: string[] = [];
    const originalExitCode = process.exitCode;

    try {
      process.exitCode = undefined;
      await main(["generate", "page", "--workspace", workspace, "--name", "Home", "--dry-run", "--json"], {
        stdout: { write: (value: string) => writes.push(value) },
      });
    } finally {
      process.exitCode = originalExitCode;
    }

    expect(JSON.parse(writes.join(""))).toMatchObject({
      ok: true,
      payload: {
        id: "generate.page.Home",
        operations: [{ kind: "createFile", path: "src/pages/Home.ets" }],
      },
      dryRun: true,
    });
    expect(fs.existsSync(path.join(workspace, "src/pages/Home.ets"))).toBe(false);
  });

  it("prints a pretty dry-run workspace edit plan", async () => {
    const workspace = createTempWorkspace();
    const writes: string[] = [];
    const originalExitCode = process.exitCode;

    try {
      process.exitCode = undefined;
      await main(["generate", "page", "--workspace", workspace, "--name", "Home", "--dry-run", "--pretty"], {
        stdout: { write: (value: string) => writes.push(value) },
      });
      expect(process.exitCode).toBeUndefined();
    } finally {
      process.exitCode = originalExitCode;
    }

    expect(writes.join("")).toBe(
      [
        "Generate page Home",
        "Mode: dry-run",
        "Affected files:",
        "- src/pages/Home.ets",
        "Operations:",
        "- Create src/pages/Home.ets",
        "",
      ].join("\n"),
    );
    expect(fs.existsSync(path.join(workspace, "src/pages/Home.ets"))).toBe(false);
  });

  it("prints pretty conflict output and sets a non-zero exit code", async () => {
    const workspace = createTempWorkspace();
    const targetPath = path.join(workspace, "src/pages/Home.ets");
    const writes: string[] = [];
    const originalExitCode = process.exitCode;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "existing");

    try {
      process.exitCode = undefined;
      await main(["generate", "page", "--workspace", workspace, "--name", "Home", "--apply", "--pretty"], {
        stdout: { write: (value: string) => writes.push(value) },
      });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }

    expect(writes.join("")).toBe(
      [
        "Generate page Home",
        "Mode: apply",
        "Conflicts:",
        "- src/pages/Home.ets: Create file target already exists.",
        "",
      ].join("\n"),
    );
    expect(fs.readFileSync(targetPath, "utf8")).toBe("existing");
  });

  it("sets a non-zero exit code when an edit command has conflicts", async () => {
    const workspace = createTempWorkspace();
    const oldPath = path.join(workspace, "src/pages/Old.ets");
    const writes: string[] = [];
    const originalExitCode = process.exitCode;
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, "old");

    try {
      process.exitCode = undefined;
      await main(
        [
          "rename-file",
          "--workspace",
          workspace,
          "--file",
          "src/pages/Old.ets",
          "--to",
          "../../../Escape.ets",
          "--apply",
          "--json",
        ],
        {
          stdout: { write: (value: string) => writes.push(value) },
        },
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = originalExitCode;
    }

    expect(JSON.parse(writes.join(""))).toMatchObject({
      ok: false,
      payload: {
        applied: false,
        conflicts: [{ path: "../../../Escape.ets" }],
      },
      dryRun: false,
    });
  });
});

describe("semantic worker client", () => {
  it("matches responses by id instead of response order", async () => {
    const worker = createMockWorker();
    const client = new SemanticWorkerClient("worker.js", {
      spawn: worker.spawn,
      timeoutMs: 100,
    });

    const first = client.request({ id: "first", method: "health" });
    const second = client.request({ id: "second", method: "health" });

    worker.stdout.write(`${JSON.stringify({ id: "second", ok: true, payload: "second result" })}\n`);
    await expect(second).resolves.toEqual({ id: "second", ok: true, payload: "second result" });

    worker.stdout.write(`${JSON.stringify({ id: "first", ok: true, payload: "first result" })}\n`);
    await expect(first).resolves.toEqual({ id: "first", ok: true, payload: "first result" });

    await client.close();
  });

  it("rejects duplicate and missing request ids", async () => {
    const worker = createMockWorker();
    const client = new SemanticWorkerClient("worker.js", {
      spawn: worker.spawn,
      timeoutMs: 100,
    });

    const pending = client.request({ id: "same", method: "health" });
    await expect(client.request({ id: "same", method: "health" })).rejects.toThrow("Duplicate semantic request id: same");
    await expect(client.request({ method: "health" })).rejects.toThrow("Semantic request payload requires a string id");

    worker.stdout.write(`${JSON.stringify({ id: "same", ok: true, payload: "ok" })}\n`);
    await expect(pending).resolves.toEqual({ id: "same", ok: true, payload: "ok" });

    await client.close();
  });

  it("times out a request that does not receive a response", async () => {
    const worker = createMockWorker();
    const client = new SemanticWorkerClient("worker.js", {
      spawn: worker.spawn,
      timeoutMs: 5,
    });

    await expect(client.request({ id: "slow", method: "health" })).rejects.toThrow(
      "Semantic worker request timed out: slow",
    );

    await client.close();
  });

  it("rejects a pending request when the worker exits before timeout", async () => {
    const worker = createMockWorker();
    const client = new SemanticWorkerClient("worker.js", {
      spawn: worker.spawn,
      timeoutMs: 10_000,
    });

    const pending = client.request({ id: "exiting", method: "health" });

    worker.process.emit("exit", 1, null);

    await expect(pending).rejects.toThrow("Semantic worker exited before responding (code 1, signal null)");

    await client.close();
  });
});

function createMockWorker() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const process = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: { write: (line: string, callback?: (error?: Error | null) => void) => void; end: () => void };
    exitCode: number | null;
    killed: boolean;
    kill: () => void;
  };

  process.stdout = stdout;
  process.stderr = stderr;
  process.exitCode = null;
  process.killed = false;
  process.stdin = {
    write: (_line, callback) => callback?.(),
    end: () => {},
  };
  process.kill = () => {
    process.killed = true;
    process.emit("exit", null, "SIGTERM");
  };

  return {
    process,
    stdout,
    spawn: () => process,
  };
}

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "arkline-cli-"));
}
