import { describe, expect, it } from "vitest";
import {
  executeSelectedRustTests,
  parseRustTestCount,
  planSelectedRustTests,
} from "../../scripts/run-selected-rust-tests.mjs";

describe("TDD selected Rust runner", () => {
  it("reads the executed case count from stable libtest output", () => {
    expect(parseRustTestCount([
      "running 16 tests",
      "test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 1045 filtered out",
    ].join("\n"))).toBe(16);
  });

  it("groups selected unit modules behind one library compilation", () => {
    const plan = planSelectedRustTests([
      "src-tauri/src/services/build_environment_service_tests.rs",
      "src-tauri/src/services/build_project_service_tests.rs",
    ]);

    expect(plan.targets).toEqual([
      {
        kind: "lib",
        name: "arkline_lib",
        filters: ["build_"],
        testPaths: [
          "src-tauri/src/services/build_environment_service_tests.rs",
          "src-tauri/src/services/build_project_service_tests.rs",
        ],
      },
    ]);
    expect(plan.cargoArgs).toEqual([
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--no-run",
      "--message-format=json-render-diagnostics",
      "--lib",
    ]);
  });

  it("maps consolidated integration source files to one Cargo test target", () => {
    const plan = planSelectedRustTests([
      "src-tauri/tests/indexer_sidecar_content_health.rs",
      "src-tauri/tests/indexer_sidecar_health.rs",
    ]);

    expect(plan.targets).toEqual([
      {
        kind: "test",
        name: "indexer_sidecar",
        filters: ["content_health::", "health::"],
        testPaths: [
          "src-tauri/tests/indexer_sidecar_content_health.rs",
          "src-tauri/tests/indexer_sidecar_health.rs",
        ],
      },
    ]);
    expect(plan.cargoArgs).toEqual([
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--no-run",
      "--message-format=json-render-diagnostics",
      "--test",
      "indexer_sidecar",
    ]);
  });

  it("runs the whole integration target when its root source file changes", () => {
    const plan = planSelectedRustTests([
      "src-tauri/tests/indexer_sidecar.rs",
      "src-tauri/tests/indexer_sidecar_health.rs",
    ]);

    expect(plan.targets[0]).toMatchObject({
      kind: "test",
      name: "indexer_sidecar",
      filters: [],
      testPaths: [
        "src-tauri/tests/indexer_sidecar.rs",
        "src-tauri/tests/indexer_sidecar_health.rs",
      ],
    });
  });

  it("compiles once and runs every selected module through the test executable", async () => {
    const plan = planSelectedRustTests([
      "src-tauri/src/services/build_environment_service_tests.rs",
      "src-tauri/src/services/build_project_service_tests.rs",
    ]);
    const invocations: Array<{ executable: string; args: string[] }> = [];

    const report = await executeSelectedRustTests(plan, {
      compile: async () => [{
        reason: "compiler-artifact",
        profile: { test: true },
        target: { kind: ["staticlib", "cdylib", "rlib"], name: "arkline_lib" },
        executable: "/tmp/arkline-lib-tests",
      }],
      runBinary: async (executable, args) => {
        invocations.push({ executable, args });
        return { exitCode: 0, durationMs: 12, executedTestCount: 16 };
      },
    });

    expect(invocations).toEqual([{
      executable: "/tmp/arkline-lib-tests",
      args: ["build_", "--test-threads=1"],
    }]);
    expect(report).toMatchObject({
      status: "passed",
      passed: true,
      selectedTestFileCount: 2,
      executedModuleCount: 1,
      executedTestCount: 16,
    });
  });

  it("fails closed when a selected Rust filter matches zero tests", async () => {
    const plan = planSelectedRustTests([
      "src-tauri/src/services/build_project_service_tests.rs",
    ]);
    const report = await executeSelectedRustTests(plan, {
      compile: async () => [{
        reason: "compiler-artifact",
        profile: { test: true },
        target: { kind: ["rlib"], name: "arkline_lib" },
        executable: "/tmp/arkline-lib-tests",
      }],
      runBinary: async () => ({
        exitCode: 0,
        durationMs: 8,
        executedTestCount: 0,
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.passed).toBe(false);
    expect(report.executedTestCount).toBe(0);
    expect(report.results[0]).toMatchObject({
      filter: "build_",
      passed: false,
      error: "Selected Rust filter matched zero tests",
    });
  });
});
