import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeControlledFailureEvidence } from "../../scripts/run-test-impact-calibration.mjs";

describe("TDD impact controlled failure calibration", () => {
  it("persists an identity-bearing confirmed failure from the real runner boundary", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-impact-calibration-"));
    try {
      const report = await writeControlledFailureEvidence({
        rootPath: root,
        reportPath: "history/calibration.json",
        environment: {
          GITHUB_RUN_ID: "400",
          GITHUB_RUN_ATTEMPT: "2",
        },
        execute: () => ({
          status: 1,
          signal: null,
          stdout: "FAIL  tests/frontend/test-impact-calibration-fixture.test.ts > Test impact calibration > emits a controlled failure identity\n",
          stderr: "",
        }),
      });
      const persisted = JSON.parse(await readFile(
        path.join(root, "history/calibration.json"),
        "utf8",
      ));

      expect(report).toMatchObject({
        classification: "confirmed-failure",
        validationEligible: true,
        sampleKind: "controlled-failure",
        sampleId: "github-actions:400:2:calibration",
        comparisonPrecision: "runner-output",
        advisoryFailedTests: [
          "tests/frontend/test-impact-calibration-fixture.test.ts > Test impact calibration > emits a controlled failure identity",
        ],
      });
      expect(persisted).toEqual(report);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a sentinel that unexpectedly passes", async () => {
    await expect(writeControlledFailureEvidence({
      rootPath: process.cwd(),
      execute: () => ({ status: 0, signal: null, stdout: "", stderr: "" }),
    })).rejects.toThrow("controlled failure fixture exited unexpectedly");
  });

  it("rejects a failure whose test identity cannot be captured", async () => {
    await expect(writeControlledFailureEvidence({
      rootPath: process.cwd(),
      execute: () => ({
        status: 1,
        signal: null,
        stdout: "Test Files 1 failed",
        stderr: "",
      }),
    })).rejects.toThrow("controlled failure identity was not captured");
  });
});
