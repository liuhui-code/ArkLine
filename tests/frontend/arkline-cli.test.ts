import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// @ts-ignore The CLI entrypoint is a Node ESM script.
import { buildSemanticRequest } from "../../scripts/arkline-cli.mjs";
// @ts-ignore The CLI parser is a Node ESM helper.
import { parseArklineCliArgs } from "../../scripts/arkline-cli/cli-parser.mjs";
// @ts-ignore The semantic client is a Node ESM helper.
import { SemanticWorkerClient } from "../../scripts/arkline-cli/semantic-client.mjs";

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

  it("rejects pretty output until it is implemented", () => {
    expect(parseArklineCliArgs(["language", "inspect", "--pretty"])).toEqual({
      ok: false,
      error: "--pretty is not implemented yet; use --json",
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
