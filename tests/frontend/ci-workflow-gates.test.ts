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

  it("runs the shared fast quality gate once for pull requests and main pushes", async () => {
    const workflow = await readWorkflow("windows-ci.yml");
    const qualityIndex = workflow.indexOf("  quality:");
    const packageIndex = workflow.indexOf("  package:");
    const qualityJob = workflow.slice(qualityIndex, packageIndex);

    expect(workflow).toContain("version: 10.12.1");
    expectPnpmBeforeNodeCache(workflow);
    expect(workflow).toContain('push:\n    branches:\n      - main');
    expect(workflow).toContain("pull_request:");
    expect(workflow).not.toContain('branches:\n      - "**"');
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

  it("uploads installer and portable packages from one Windows candidate build", async () => {
    const workflow = await readWorkflow("windows-ci.yml");

    expect(workflow).toContain("run: pnpm package:windows:candidate");
    expect(workflow).toContain("name: arkline-windows-candidate");
    expect(workflow).toContain("src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe");
    expect(workflow).toContain("dist/ArkLine-windows-x64.zip");
    expect(workflow).toContain("run: node scripts/release-candidate-manifest.mjs");
    expect(workflow).toContain("artifacts/release-candidate-manifest.json");
    expect(workflow).not.toContain("name: arkline-windows-bundle");
  });

  it("runs the complete frontend release gate automatically for main candidates", async () => {
    const workflow = await readWorkflow("windows-ci.yml");

    expect(workflow).toContain("name: Release Candidate / Frontend");
    expect(workflow).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(workflow).toContain("run: pnpm check:release:frontend");
  });

  it("smokes both the installed and portable artifacts downloaded from the main candidate", async () => {
    const workflow = await readWorkflow("windows-ci.yml");

    expect(workflow).toContain("name: Release Candidate / Windows Smoke");
    expect(workflow).toContain("needs: package");
    expect(workflow).toContain("name: arkline-windows-candidate");
    expect(workflow).toContain("name: Install candidate silently");
    expect(workflow).toContain('"/S", "/D=$installRoot"');
    expect(workflow).toContain("ARKLINE_INSTALLED_APPLICATION");
    expect(workflow).toContain("Run installed candidate semantic smoke");
    expect(workflow).toContain("Run portable candidate semantic smoke");
    expect(workflow).toContain("--application=artifacts/release-verify/ArkLine.exe");
    expect(workflow).toContain("--rev 8c4b34f51b45f5cf08013366d703de464ab871d1");
    expect(workflow).toContain("ref: 17b6899086a57a4d48448842a14f9e325e3e35a3");
    expect(workflow).toContain("if (-not $env:ARKLINE_CANDIDATE_INSTALL_ROOT) { exit 0 }");
  });

  it("marks a main candidate release-ready only after every release gate passes", async () => {
    const workflow = await readWorkflow("windows-ci.yml");

    expect(workflow).toContain("name: Release Ready");
    expect(workflow).toContain("needs: [release-frontend, candidate-smoke]");
    expect(workflow).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(workflow).toContain("ARKLINE_RELEASE_READY ${{ github.sha }}");
  });

  it("promotes one successful main candidate without rebuilding or manually replacing assets", async () => {
    const workflow = await readWorkflow("windows-exe-release.yml");

    expect(workflow).toContain("name: windows-exe-release");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("candidate_run_id:");
    expect(workflow).toContain("required: true");
    expect(workflow).not.toContain("  push:");
    expect(workflow).toContain("name: Release / Promote Candidate");
    expect(workflow).toContain("name: Validate successful main candidate run");
    expect(workflow).toContain(".github/workflows/windows-ci.yml");
    expect(workflow).toContain("Release Ready");
    expect(workflow).toContain("head_branch");
    expect(workflow).toContain("conclusion");
    expect(workflow).toContain("uses: actions/download-artifact@v5");
    expect(workflow).toContain("name: arkline-windows-candidate");
    expect(workflow).toContain("run-id: ${{ inputs.candidate_run_id }}");
    expect(workflow).toContain("github-token: ${{ github.token }}");
    expect(workflow).toContain("run: node scripts/verify-release-candidate.mjs");
    expect(workflow).toContain('"${{ steps.verify.outputs.installer_path }}"');
    expect(workflow).toContain('"${{ steps.verify.outputs.portable_path }}"');
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--draft");
    expect(workflow).toContain('--target "$CANDIDATE_SHA"');
    expect(workflow).toContain('gh release delete "$RELEASE_TAG" --yes --cleanup-tag');
    expect(workflow).toContain("Verify draft release assets");
    expect(workflow).toContain('gh release edit "$RELEASE_TAG" --draft=false');
    expect(workflow).toContain("Verify published release assets");
    expect(workflow.indexOf("Verify draft release assets")).toBeLessThan(
      workflow.indexOf("Publish verified draft"),
    );
    expect(workflow).not.toContain("--clobber");
    expect(workflow).not.toMatch(/pnpm (?:build|check|package|test|perf)/u);
    expect(workflow).not.toContain("cargo ");
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
