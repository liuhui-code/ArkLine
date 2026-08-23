import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function readWorkflow(name: string) {
  return readFile(
    path.join(process.cwd(), ".github", "workflows", name),
    "utf8",
  );
}

async function readScript(name: string) {
  return readFile(
    path.join(process.cwd(), "scripts", name),
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
  it("blocks pull requests without complete executable TDD evidence", async () => {
    const workflow = await readWorkflow("tdd-enforcement.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("name: TDD Evidence");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("ARKLINE_PR_BODY: ${{ github.event.pull_request.body }}");
    expect(workflow).toContain("ARKLINE_BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).toContain("ARKLINE_HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain(
      'pnpm test:tdd:evidence -- --base="$ARKLINE_BASE_SHA" --head="$ARKLINE_HEAD_SHA"',
    );
    expect(workflow).not.toContain("continue-on-error");
  });

  it("runs the shared fast quality gate for every branch before the Windows package job", async () => {
    const workflow = await readWorkflow("windows-ci.yml");
    const qualityIndex = workflow.indexOf("  quality:");
    const packageIndex = workflow.indexOf("  package:");
    const qualityJob = workflow.slice(qualityIndex, packageIndex);

    expect(workflow).toContain("version: 10.12.1");
    expectPnpmBeforeNodeCache(workflow);
    expect(workflow).toContain('branches:\n      - "**"');
    expect(workflow).toContain("run: pnpm check:fast");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("name: Run TDD impact advisory");
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain('pnpm test:impact:advisory -- --base="$ARKLINE_BASE_SHA" --head="$GITHUB_SHA"');
    expect(workflow).toContain("name: Reconcile TDD impact evidence");
    expect(workflow).toContain("run: pnpm test:impact:reconcile");
    expect(workflow).toContain("retention-days: 90");
    expect(workflow.indexOf("run: pnpm test:impact:reconcile")).toBeGreaterThan(
      workflow.indexOf("run: pnpm check:fast"),
    );
    expect(workflow).toContain("name: Quality Gate / Fast");
    expect(workflow).toContain("name: Windows / Package");
    expect(workflow).toContain("needs: quality");
    expect(qualityJob).toContain("name: Install Linux desktop dependencies");
    expect(qualityJob).toContain("run: bash scripts/install-tauri-linux-deps.sh");
    expect(qualityJob.indexOf("name: Install Linux desktop dependencies")).toBeLessThan(
      qualityJob.indexOf("run: pnpm check:fast"),
    );
    expect(workflow).toContain("github.event.pull_request.head.ref || github.ref_name");
    expect(workflow).toContain("cancel-in-progress: ${{ github.ref_name != 'main' }}");
    expect(workflow).not.toContain("run: pnpm test\n");
    expect(workflow).not.toContain(
      "run: cargo test --manifest-path src-tauri/Cargo.toml",
    );
    expect(workflow).not.toContain("run: pnpm perf:runtime");
  });

  it("installs Linux desktop dependencies once through the bounded shared script", async () => {
    const workflow = await readWorkflow("windows-ci.yml");
    const qualityIndex = workflow.indexOf("  quality:");
    const packageIndex = workflow.indexOf("  package:");
    const qualityJob = workflow.slice(qualityIndex, packageIndex);

    expect(qualityJob).toContain("run: bash scripts/install-tauri-linux-deps.sh");
    expect(qualityJob).not.toContain("sudo apt-get");
  });

  it("validates and builds a Windows release before creating its tag", async () => {
    const workflow = await readWorkflow("windows-exe-release.yml");
    const qualityIndex = workflow.indexOf("  quality:");
    const rustIndex = workflow.indexOf("  rust:");
    const packageIndex = workflow.indexOf("  build-windows-exe:");
    const publishIndex = workflow.indexOf("  publish-release:");
    const qualityJob = workflow.slice(qualityIndex, rustIndex);
    const rustJob = workflow.slice(rustIndex, packageIndex);
    const packageJob = workflow.slice(packageIndex, publishIndex);
    const publishJob = workflow.slice(publishIndex);

    expect(workflow).toContain("name: windows-exe-release");
    expect(workflow).toContain("version: 10.12.1");
    expectPnpmBeforeNodeCache(workflow);
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("required: true");
    expect(workflow).not.toContain("  push:");
    expect(workflow).not.toContain("cargo-xwin");
    expect(workflow).not.toContain("brew install");

    expect(qualityJob).toContain("needs: validate-release");
    expect(qualityJob).toContain("runs-on: ubuntu-latest");
    expect(qualityJob).toContain("run: pnpm check:release:frontend");
    expect(qualityJob).not.toContain("pnpm test:rust");
    expect(rustJob).toContain("needs: validate-release");
    expect(rustJob).toContain("runs-on: ubuntu-latest");
    expect(rustJob).toContain("run: bash scripts/install-tauri-linux-deps.sh");
    expect(rustJob).toContain("run: pnpm check:release:rust");
    expect(rustJob).not.toContain("cache: pnpm");
    expect(packageJob).toContain("needs: validate-release");
    expect(packageJob).not.toContain("needs: quality");
    expect(packageJob).toContain("runs-on: windows-latest");
    expect(packageJob).toContain("uses: Swatinem/rust-cache@v2");
    expect(packageJob).toContain("run: pnpm package:windows:portable");
    expect(packageJob).toContain("Run packaged real-project semantic smoke");
    expect(packageJob).toContain("--application=artifacts/release-verify/ArkLine.exe");

    expect(workflow).toContain("name: Release / Publish");
    expect(publishJob).toContain("needs:\n      - quality\n      - rust\n      - build-windows-exe");
    expect(publishJob).toContain("permissions:\n      contents: write");
    expect(publishJob).toContain("uses: actions/download-artifact@v5");
    expect(publishJob).toContain('gh release create "$RELEASE_TAG" dist/ArkLine-windows-x64.zip');
    expect(publishJob).toContain('--target "$GITHUB_SHA"');
    expect(publishJob).not.toContain("--clobber");
  });

  it("bounds and retries non-interactive Tauri dependency installation", async () => {
    const script = await readScript("install-tauri-linux-deps.sh");

    expect(script).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(script).toContain("timeout --signal=TERM 4m");
    expect(script).toContain("Acquire::Retries=3");
    expect(script).toContain("Acquire::http::Timeout=30");
    expect(script).toContain("for attempt in 1 2");
    expect(script).toContain("--no-install-recommends");
    expect(script).toContain("libwebkit2gtk-4.1-dev");
    expect(script).toContain("libayatana-appindicator3-dev");
    expect(script).toContain("librsvg2-dev");
  });

  it("collects and calibrates test-impact history on a non-blocking schedule", async () => {
    const workflow = await readWorkflow("test-impact-evidence.yml");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("gh run list --workflow=windows-ci.yml");
    expect(workflow).toContain("gh run list --workflow=test-impact-evidence.yml");
    expect(workflow).toContain('gh run download "$run_id"');
    expect(workflow).toContain("pnpm test:impact:calibration");
    expect(workflow).toContain("pnpm test:impact:history");
    expect(workflow).toContain("pnpm test:impact:review");
    expect(workflow).toContain('cat artifacts/test-impact-promotion-review.md >> "$GITHUB_STEP_SUMMARY"');
    expect(workflow).toContain("artifacts/test-impact-promotion-review.json");
    expect(workflow).toContain("artifacts/test-impact-promotion-review.md");
    expect(workflow.indexOf("pnpm test:impact:review")).toBeGreaterThan(
      workflow.indexOf("pnpm test:impact:history"),
    );
    expect(workflow.indexOf("$GITHUB_STEP_SUMMARY")).toBeGreaterThan(
      workflow.indexOf("pnpm test:impact:review"),
    );
    expect(workflow).toContain("name: arkline-test-impact-calibration");
    expect(workflow).toContain("name: arkline-test-impact-history");
    expect(workflow).toContain("retention-days: 90");
    expect(workflow).not.toContain("continue-on-error");
  });
});
