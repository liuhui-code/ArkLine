import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts?: Record<string, string>;
};

async function readPackageScripts() {
  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as PackageJson;
  return packageJson.scripts ?? {};
}

describe("package scripts", () => {
  it("provides fast and full quality gates including backend line count and rust tests", async () => {
    const scripts = await readPackageScripts();

    expect(scripts["test:frontend"]).toBe("vitest run");
    expect(scripts["test:frontend:gate"]).toBe("node scripts/run-frontend-gate.mjs --strict");
    expect(scripts["test:frontend:quality"]).toBe(
      "vitest run tests/frontend/package-scripts.test.ts tests/frontend/run-quality-gate.test.ts tests/frontend/quality-gate-manifest.test.ts tests/frontend/indexing-roadmap-status.test.ts tests/frontend/ci-workflow-gates.test.ts tests/frontend/packaged-soak-foundation.test.ts tests/frontend/packaged-soak-webdriver.test.ts tests/frontend/readme-quality-gates.test.ts tests/frontend/check-line-count.test.mjs tests/frontend/app-crash-boundary.test.tsx tests/frontend/editor-crash-boundary.test.tsx tests/frontend/ui-latency-monitor.test.ts",
    );
    expect(scripts["fixture:performance"]).toBe(
      "node scripts/generate-performance-fixture.mjs",
    );
    expect(scripts["perf:packaged:windows"]).toBe(
      "node scripts/run-windows-packaged-soak.mjs --strict",
    );
    expect(scripts["check:fast"]).toBe(
      "node scripts/run-quality-gate.mjs --gate=fast --strict",
    );
    expect(scripts.check).toBe(
      "node scripts/run-quality-gate.mjs --gate=full --strict",
    );
    expect(scripts["test:rust"]).toBe("node scripts/test-rust.mjs");
    expect(scripts["check:whitespace"]).toBe("git diff --check HEAD --");
  });
});
