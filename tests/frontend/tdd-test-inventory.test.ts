import { describe, expect, it } from "vitest";
import { buildTestInventory } from "../../scripts/test-inventory.mjs";

describe("TDD test inventory", () => {
  it("classifies every repository test and exposes unresolved capability debt", async () => {
    const report = await buildTestInventory({ rootPath: process.cwd() });
    const runners = new Set(report.tests.map((test) => test.runner));

    expect(report.schemaVersion).toBe(1);
    expect(report.summary.totalFiles).toBe(report.tests.length);
    expect(report.summary.totalFiles).toBeGreaterThan(250);
    expect(runners).toEqual(new Set([
      "frontend",
      "semantic-worker",
      "rust-unit",
      "rust-integration",
    ]));
    expect(report.tests.every((test) => (
      test.path.length > 0
      && test.domain.length > 0
      && test.owner.length > 0
      && ["small", "medium", "large", "product"].includes(test.size)
      && typeof test.hermetic === "boolean"
    ))).toBe(true);
    expect(report.summary.ignoredFiles).toBeGreaterThan(0);
    expect(report.summary.mockCallAssertionFiles).toBeGreaterThan(0);
    expect(report.summary.unmappedCapabilityFiles).toBeGreaterThanOrEqual(0);
    expect(report.tests.map((test) => test.path)).not.toContain(
      "src-tauri/tests/indexer_sidecar.rs",
    );
    expect(report.tests.find((test) => (
      test.path === "src-tauri/src/services/workspace_index_writer_connection_pool_service.rs"
    ))?.capabilities).toContain("project-open-index-readiness");
  });
});
