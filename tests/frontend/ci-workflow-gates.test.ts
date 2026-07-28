import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readWorkflow(name: string) {
  return readFile(
    path.join(process.cwd(), ".github", "workflows", name),
    "utf8",
  );
}

function expectPnpmBeforeNodeCache(workflow: string) {
  const pnpmIndex = workflow.indexOf("name: Setup pnpm");
  const nodeIndex = workflow.indexOf("name: Setup Node.js");

  expect(pnpmIndex).toBeGreaterThanOrEqual(0);
  expect(nodeIndex).toBeGreaterThan(pnpmIndex);
}

describe("CI quality gates", () => {
  it("runs the shared fast quality gate before the Windows package job", async () => {
    const workflow = await readWorkflow("windows-ci.yml");

    expect(workflow).toContain("version: 10.12.1");
    expectPnpmBeforeNodeCache(workflow);
    expect(workflow).toContain("run: pnpm check:fast");
    expect(workflow).toContain("name: Quality Gate / Fast");
    expect(workflow).toContain("name: Windows / Package");
    expect(workflow).toContain("needs: quality");
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(workflow).not.toContain("run: pnpm test\n");
    expect(workflow).not.toContain(
      "run: cargo test --manifest-path src-tauri/Cargo.toml",
    );
    expect(workflow).not.toContain("run: pnpm perf:runtime");
  });

  it("runs the full release quality gate before publishing the portable exe", async () => {
    const workflow = await readWorkflow("macos-windows-exe.yml");
    const installIndex = workflow.indexOf("run: pnpm install --frozen-lockfile");
    const gateIndex = workflow.indexOf("run: pnpm check\n");
    const packageIndex = workflow.indexOf("run: pnpm package:windows:portable");

    expect(workflow).toContain("version: 10.12.1");
    expectPnpmBeforeNodeCache(workflow);
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("name: Release / Publish");
    expect(workflow).toContain("needs: build-windows-exe");
    expect(workflow).toContain("permissions:\n      contents: write");
    expect(gateIndex).toBeGreaterThan(installIndex);
    expect(packageIndex).toBeGreaterThan(gateIndex);
  });
});
