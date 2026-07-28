import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runQualityGate } from "../../scripts/run-quality-gate.mjs";

async function withManifest(steps: string[], callback: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "arkline-quality-gate-"));
  try {
    await writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({ gates: { test: { description: "test gate", steps, stepTimeoutMs: 30_000 } } }),
      "utf8",
    );
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("quality gate runner", () => {
  it("runs every stage and persists a passing report", async () => {
    await withManifest(["node -e \"process.exit(0)\"", "node -e \"process.exit(0)\""], async (root) => {
      const report = await runQualityGate({
        gateName: "test",
        manifestPath: path.join(root, "manifest.json"),
        reportPath: path.join(root, "report.json"),
      });

      expect(report.passed).toBe(true);
      expect(report.steps).toHaveLength(2);
      expect(JSON.parse(await readFile(path.join(root, "report.json"), "utf8"))).toMatchObject({
        gate: "test",
        passed: true,
      });
    });
  });

  it("stops at the first failed stage and records the failure", async () => {
    await withManifest(["node -e \"process.exit(7)\"", "node -e \"process.exit(0)\""], async (root) => {
      const report = await runQualityGate({
        gateName: "test",
        manifestPath: path.join(root, "manifest.json"),
        reportPath: path.join(root, "report.json"),
      });

      expect(report.passed).toBe(false);
      expect(report.failedStep).toBe("node -e \"process.exit(7)\"");
      expect(report.steps).toHaveLength(1);
    });
  });
});
