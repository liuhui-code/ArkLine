import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readWorkflow(name: string) {
  return readFile(
    path.join(process.cwd(), ".github", "workflows", name),
    "utf8",
  );
}

describe("CI quality gates", () => {
  it("runs the shared fast quality gate on Windows with the package pnpm version", async () => {
    const workflow = await readWorkflow("windows-ci.yml");

    expect(workflow).toContain("version: 10.12.1");
    expect(workflow).toContain("run: pnpm check:fast");
    expect(workflow).not.toContain("run: pnpm test\n");
    expect(workflow).not.toContain(
      "run: cargo test --manifest-path src-tauri/Cargo.toml",
    );
    expect(workflow).not.toContain("run: pnpm perf:runtime");
  });
});
