import { describe, expect, it } from "vitest";
import { buildTestImpactReport, planTestImpact } from "../../scripts/test-impact.mjs";
import {
  executeImpactAdvisory,
  planImpactAdvisory,
} from "../../scripts/run-test-impact.mjs";

const registry = {
  alwaysRunTests: ["tests/frontend/tdd-capability-registry.test.ts"],
  fullSuitePatterns: ["tests/frontend/**/*.test.ts", "src-tauri/src/**/*_tests.rs"],
  globalFallbackPatterns: ["package.json", "src/components/layout/AppShell.tsx"],
  capabilities: [
    {
      id: "real-project-build",
      sourcePatterns: ["src/features/build/**", "src-tauri/src/services/build_*"],
      testPatterns: ["tests/frontend/*build*.test.ts", "src-tauri/src/services/build_*_tests.rs"],
    },
    {
      id: "git-core-workflow",
      sourcePatterns: ["src/features/git/**"],
      testPatterns: ["tests/frontend/*git*.test.ts"],
    },
  ],
};

const inventory = {
  tests: [
    { path: "tests/frontend/tdd-capability-registry.test.ts" },
    { path: "tests/frontend/build-domain.test.ts" },
    { path: "src-tauri/src/services/build_project_service_tests.rs" },
    { path: "tests/frontend/git-commit-model.test.ts" },
    { path: "tests/frontend/unrelated.test.ts" },
  ],
};

describe("TDD test impact planner", () => {
  it("selects capability tests and always-run contracts for a known change", () => {
    const plan = planTestImpact({
      changedFiles: ["src/features/build/build-preflight.ts"],
      registry,
      inventory,
    });

    expect(plan.fallbackToFull).toBe(false);
    expect(plan.impactedCapabilities).toEqual(["real-project-build"]);
    expect(plan.selectedTests).toEqual([
      "src-tauri/src/services/build_project_service_tests.rs",
      "tests/frontend/build-domain.test.ts",
      "tests/frontend/tdd-capability-registry.test.ts",
    ]);
  });

  it("falls back to the full suite for global contracts", () => {
    const plan = planTestImpact({
      changedFiles: ["src/components/layout/AppShell.tsx"],
      registry,
      inventory,
    });

    expect(plan.fallbackToFull).toBe(true);
    expect(plan.fallbackReasons).toEqual(["global-contract:src/components/layout/AppShell.tsx"]);
    expect(plan.selectedTests).toEqual(inventory.tests.map((test) => test.path).sort());
  });

  it("fails safe when production changes have no registered capability", () => {
    const plan = planTestImpact({
      changedFiles: ["src/features/new-domain/unmapped-runtime.ts"],
      registry,
      inventory,
    });

    expect(plan.fallbackToFull).toBe(true);
    expect(plan.fallbackReasons).toEqual([
      "unmapped-production:src/features/new-domain/unmapped-runtime.ts",
    ]);
    expect(plan.selectedTests).toEqual(inventory.tests.map((test) => test.path).sort());
  });

  it("always includes changed tests and previously failing tests", () => {
    const plan = planTestImpact({
      changedFiles: ["tests/frontend/git-commit-model.test.ts", "docs/readme.md"],
      previousFailures: ["tests/frontend/unrelated.test.ts"],
      registry,
      inventory,
    });

    expect(plan.fallbackToFull).toBe(false);
    expect(plan.selectedTests).toEqual([
      "tests/frontend/git-commit-model.test.ts",
      "tests/frontend/tdd-capability-registry.test.ts",
      "tests/frontend/unrelated.test.ts",
    ]);
  });

  it("builds a repository shadow report from the committed registry and inventory", async () => {
    const report = await buildTestImpactReport({
      rootPath: process.cwd(),
      changedFiles: ["src/features/build/build-preflight.ts"],
    });

    expect(report.mode).toBe("shadow");
    expect(report.impactedCapabilities).toContain("real-project-build");
    expect(report.selectedTests).toContain("tests/frontend/build-domain.test.ts");
    expect(report.inventorySummary.totalFiles).toBeGreaterThan(250);
    expect(report.selectedByRunner.frontend).toContain("tests/frontend/build-domain.test.ts");
    expect(report.selectedByRunner["rust-unit"]).toContain(
      "src-tauri/src/services/build_project_service_tests.rs",
    );
    expect(report.selectionRate).toBeGreaterThan(0);
    expect(report.selectionRate).toBeLessThan(1);
  });

  it("falls back to full when the changed-file diff cannot be resolved", () => {
    const plan = planTestImpact({
      changedFiles: [],
      selectionFailure: "diff-unavailable",
      registry,
      inventory,
    });

    expect(plan.fallbackToFull).toBe(true);
    expect(plan.fallbackReasons).toEqual(["diff-unavailable"]);
    expect(plan.selectedTests).toEqual(inventory.tests.map((test) => test.path).sort());
  });

  it("executes frontend, semantic-worker, and Rust selections", () => {
    const advisory = planImpactAdvisory({
      fallbackToFull: false,
      fallbackReasons: [],
      selectedTests: [
        "semantic-worker/src/__tests__/completion.test.ts",
        "src-tauri/src/services/build_project_service_tests.rs",
        "tests/frontend/build-domain.test.ts",
      ],
      selectedByRunner: {
        frontend: ["tests/frontend/build-domain.test.ts"],
        "semantic-worker": ["semantic-worker/src/__tests__/completion.test.ts"],
        "rust-unit": ["src-tauri/src/services/build_project_service_tests.rs"],
      },
    });

    expect(advisory.commands).toEqual([
      {
        runner: "frontend",
        command: "pnpm",
        args: ["exec", "vitest", "run", "tests/frontend/build-domain.test.ts"],
        testPaths: ["tests/frontend/build-domain.test.ts"],
      },
      {
        runner: "semantic-worker",
        command: "pnpm",
        args: ["--dir", "semantic-worker", "exec", "vitest", "run", "src/__tests__/completion.test.ts"],
        testPaths: ["semantic-worker/src/__tests__/completion.test.ts"],
      },
      {
        runner: "rust",
        command: "node",
        args: [
          "scripts/run-selected-rust-tests.mjs",
          "--paths=src-tauri/src/services/build_project_service_tests.rs",
        ],
        testPaths: ["src-tauri/src/services/build_project_service_tests.rs"],
      },
    ]);
    expect(advisory.deferredByRunner).toEqual({});
    expect(advisory.executableTestCount).toBe(3);
    expect(advisory.deferredTestCount).toBe(0);
  });

  it("records passing advisory commands as executable evidence", async () => {
    const plan = planImpactAdvisory({
      fallbackToFull: false,
      fallbackReasons: [],
      selectedTests: ["tests/frontend/build-domain.test.ts"],
      selectedByRunner: {
        frontend: ["tests/frontend/build-domain.test.ts"],
      },
    });

    const report = await executeImpactAdvisory(plan, {
      runCommand: async () => ({ exitCode: 0, durationMs: 42 }),
    });

    expect(report.status).toBe("passed");
    expect(report.passed).toBe(true);
    expect(report.executedTestCount).toBe(1);
    expect(report.results).toEqual([
      expect.objectContaining({
        runner: "frontend",
        exitCode: 0,
        durationMs: 42,
        passed: true,
        testPaths: ["tests/frontend/build-domain.test.ts"],
      }),
    ]);
  });

  it("delegates a fail-safe full selection instead of duplicating the authoritative gate", async () => {
    const plan = planImpactAdvisory({
      fallbackToFull: true,
      fallbackReasons: ["diff-unavailable"],
      selectedTests: [
        "src-tauri/src/services/build_project_service_tests.rs",
        "tests/frontend/build-domain.test.ts",
      ],
      selectedByRunner: {
        frontend: ["tests/frontend/build-domain.test.ts"],
        "rust-unit": ["src-tauri/src/services/build_project_service_tests.rs"],
      },
    });
    const report = await executeImpactAdvisory(plan, {
      runCommand: async () => {
        throw new Error("delegated plans must not execute selected commands");
      },
    });

    expect(plan.commands).toEqual([]);
    expect(report.status).toBe("delegated");
    expect(report.passed).toBe(true);
    expect(report.executedTestCount).toBe(0);
    expect(report.deferredTestCount).toBe(2);
    expect(report.authoritativeGate).toBe("pnpm check:fast");
  });

  it("records selected-test failures without hiding later runner evidence", async () => {
    const plan = planImpactAdvisory({
      fallbackToFull: false,
      fallbackReasons: [],
      selectedTests: [
        "semantic-worker/src/__tests__/completion.test.ts",
        "tests/frontend/build-domain.test.ts",
      ],
      selectedByRunner: {
        frontend: ["tests/frontend/build-domain.test.ts"],
        "semantic-worker": ["semantic-worker/src/__tests__/completion.test.ts"],
      },
    });
    const invoked = [];
    const report = await executeImpactAdvisory(plan, {
      runCommand: async (command) => {
        invoked.push(command.runner);
        return { exitCode: command.runner === "frontend" ? 1 : 0, durationMs: 10 };
      },
    });

    expect(invoked).toEqual(["frontend", "semantic-worker"]);
    expect(report.status).toBe("failed");
    expect(report.passed).toBe(false);
    expect(report.results.map((result) => result.passed)).toEqual([false, true]);
  });

  it("reports fully passed after selected frontend and Rust tests are green", async () => {
    const plan = planImpactAdvisory({
      fallbackToFull: false,
      fallbackReasons: [],
      selectedTests: [
        "src-tauri/src/services/build_project_service_tests.rs",
        "tests/frontend/build-domain.test.ts",
      ],
      selectedByRunner: {
        frontend: ["tests/frontend/build-domain.test.ts"],
        "rust-unit": ["src-tauri/src/services/build_project_service_tests.rs"],
      },
    });
    const report = await executeImpactAdvisory(plan, {
      runCommand: async () => ({ exitCode: 0, durationMs: 10 }),
    });

    expect(report.status).toBe("passed");
    expect(report.passed).toBe(true);
    expect(report.executedTestCount).toBe(2);
    expect(report.deferredTestCount).toBe(0);
  });
});
