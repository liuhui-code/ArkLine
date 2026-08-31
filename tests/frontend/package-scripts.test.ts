import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rustTestEnvironment } from "../../scripts/test-rust.mjs";

type PackageJson = {
  scripts?: Record<string, string>;
};

type TypeScriptConfig = {
  include?: string[];
};

async function readPackageScripts() {
  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as PackageJson;
  return packageJson.scripts ?? {};
}

async function readAppTypeScriptConfig() {
  return JSON.parse(
    await readFile(path.join(process.cwd(), "tsconfig.app.json"), "utf8"),
  ) as TypeScriptConfig;
}

describe("package scripts", () => {
  it("provides fast and full quality gates including backend line count and rust tests", async () => {
    const scripts = await readPackageScripts();

    expect(scripts["test:frontend"]).toBe("vitest run");
    expect(scripts["test:frontend:gate"]).toBe("node scripts/run-frontend-gate.mjs --strict");
    expect(scripts["test:frontend:quality"]).toBe(
      "vitest run tests/frontend/package-scripts.test.ts tests/frontend/run-quality-gate.test.ts tests/frontend/quality-gate-manifest.test.ts tests/frontend/indexing-roadmap-status.test.ts tests/frontend/ci-workflow-gates.test.ts tests/frontend/release-version.test.ts tests/frontend/runtime-logging-contract.test.ts tests/frontend/release-candidate-manifest.test.ts tests/frontend/verify-release-candidate.test.ts tests/frontend/packaged-soak-foundation.test.ts tests/frontend/packaged-soak-report.test.ts tests/frontend/packaged-soak-webdriver.test.ts tests/frontend/readme-quality-gates.test.ts tests/frontend/check-line-count.test.mjs tests/frontend/app-crash-boundary.test.tsx tests/frontend/editor-crash-boundary.test.tsx tests/frontend/ui-latency-monitor.test.ts tests/frontend/tdd-capability-registry.test.ts tests/frontend/tdd-test-inventory.test.ts tests/frontend/tdd-test-impact.test.ts tests/frontend/tdd-rust-impact.test.ts tests/frontend/tdd-test-impact-reconciliation.test.ts tests/frontend/tdd-test-impact-history.test.ts tests/frontend/tdd-test-impact-calibration.test.ts tests/frontend/tdd-test-impact-promotion-review.test.ts tests/frontend/tdd-enforcement.test.ts tests/frontend/tdd-governance.test.ts",
    );
    expect(scripts["fixture:performance"]).toBe(
      "node scripts/generate-performance-fixture.mjs",
    );
    expect(scripts["perf:packaged:windows"]).toBe(
      "node scripts/run-windows-packaged-soak.mjs --strict",
    );
    expect(scripts["package:windows:candidate"]).toBe(
      "node scripts/package-windows.mjs --target=windows-candidate",
    );
    expect(scripts["check:fast"]).toBe(
      "node scripts/run-quality-gate.mjs --gate=fast --strict",
    );
    expect(scripts["check:version"]).toBe("node scripts/release-version.mjs");
    expect(scripts.check).toBe(
      "node scripts/run-quality-gate.mjs --gate=full --strict",
    );
    expect(scripts["check:release:frontend"]).toBe(
      "node scripts/run-quality-gate.mjs --gate=release-frontend --strict",
    );
    expect(scripts["check:release:rust"]).toBe(
      "node scripts/run-quality-gate.mjs --gate=release-rust --strict",
    );
    expect(scripts["test:rust"]).toBe("node scripts/test-rust.mjs");
    expect(scripts["test:inventory"]).toBe("node scripts/test-inventory.mjs");
    expect(scripts["test:impact:shadow"]).toBe("node scripts/test-impact.mjs");
    expect(scripts["test:impact:advisory"]).toBe("node scripts/run-test-impact.mjs");
    expect(scripts["test:impact:reconcile"]).toBe(
      "node scripts/reconcile-test-impact.mjs",
    );
    expect(scripts["test:impact:history"]).toBe(
      "node scripts/aggregate-test-impact.mjs",
    );
    expect(scripts["test:impact:calibration"]).toBe(
      "node scripts/run-test-impact-calibration.mjs",
    );
    expect(scripts["test:impact:review"]).toBe(
      "node scripts/review-test-impact-promotion.mjs",
    );
    expect(scripts["test:tdd:evidence"]).toBe(
      "node scripts/verify-tdd-evidence.mjs",
    );
    expect(scripts["check:whitespace"]).toBe("git diff --check HEAD --");
  });

  it("keeps frontend tests out of the production package typecheck", async () => {
    const config = await readAppTypeScriptConfig();

    expect(config.include).toEqual(["src", "vite.config.ts", "vitest.config.ts"]);
  });

  it("runs macOS Rust tests through an isolated binary directory", () => {
    const environment = rustTestEnvironment("darwin", "x64", {});

    expect(environment.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER).toBe(
      `node ${path.resolve("scripts/run-rust-test-binary.mjs")}`,
    );
  });

  it("executes a staged Rust test binary with its arguments", () => {
    const fixtureDirectory = mkdtempSync(path.join(tmpdir(), "arkline-runner-probe-"));
    try {
      const executable = process.platform === "win32"
        ? process.execPath
        : path.join(fixtureDirectory, "probe.sh");
      const executableArgs = process.platform === "win32"
        ? ["-e", "process.stdout.write(process.argv[1])", "runner-ok"]
        : ["runner-ok"];
      if (process.platform !== "win32") {
        writeFileSync(executable, "#!/bin/sh\nprintf '%s' \"$1\"\n", "utf8");
        chmodSync(executable, 0o755);
      }
      const result = spawnSync(process.execPath, [
        "scripts/run-rust-test-binary.mjs",
        executable,
        ...executableArgs,
      ], { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("runner-ok");
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  }, 45_000);
});
