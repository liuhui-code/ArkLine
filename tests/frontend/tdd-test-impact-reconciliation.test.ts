import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  reconcileImpactEvidence,
  writeImpactReconciliation,
} from "../../scripts/reconcile-test-impact.mjs";

describe("TDD impact evidence reconciliation", () => {
  it("records an eligible validated sample when advisory and authoritative tests pass", () => {
    const report = reconcileImpactEvidence({
      advisoryReport: {
        status: "passed",
        fallbackToFull: false,
        deferredTestCount: 0,
        selectedTestCount: 12,
        executedTestCount: 12,
      },
      qualityGateReport: {
        gate: "fast",
        passed: true,
        failedStep: null,
      },
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      classification: "validated-pass",
      validationEligible: true,
      potentialFalseNegativeObserved: false,
      potentialFalsePositiveObserved: false,
      selectedTestCount: 12,
      executedTestCount: 12,
      comparisonPrecision: "gate-step",
    });
    expect(report.falseNegativeRate).toBeNull();
  });

  it("flags a potential false negative when fully executed advisory passes but a full test step fails", () => {
    const report = reconcileImpactEvidence({
      advisoryReport: {
        status: "passed",
        fallbackToFull: false,
        deferredTestCount: 0,
        selectedTestCount: 8,
        executedTestCount: 8,
      },
      qualityGateReport: {
        gate: "fast",
        passed: false,
        failedStep: "pnpm test:rust",
        steps: [{
          command: "pnpm test:rust",
          passed: false,
          failedTests: ["services::build_project_service::tests::rejects_invalid_root"],
          failureIdentityPrecision: "runner-output",
        }],
      },
    });

    expect(report).toMatchObject({
      classification: "potential-false-negative",
      validationEligible: true,
      potentialFalseNegativeObserved: true,
      potentialFalsePositiveObserved: false,
      observedTestFailureCount: 1,
      falseNegativeRate: 1,
      comparisonPrecision: "runner-output",
      authoritativeFailedTests: [
        "services::build_project_service::tests::rejects_invalid_root",
      ],
    });
  });

  it("flags an advisory-only failure for false-positive investigation", () => {
    const report = reconcileImpactEvidence({
      advisoryReport: {
        status: "failed",
        fallbackToFull: false,
        deferredTestCount: 0,
        selectedTestCount: 6,
        executedTestCount: 6,
      },
      qualityGateReport: {
        gate: "fast",
        passed: true,
        failedStep: null,
      },
    });

    expect(report).toMatchObject({
      classification: "potential-false-positive",
      validationEligible: true,
      potentialFalseNegativeObserved: false,
      potentialFalsePositiveObserved: true,
      observedTestFailureCount: 1,
      falseNegativeRate: 0,
      falsePositiveRate: 1,
    });
  });

  it("keeps delegated full selections out of validation samples", () => {
    const report = reconcileImpactEvidence({
      advisoryReport: {
        status: "delegated",
        fallbackToFull: true,
        deferredTestCount: 535,
        selectedTestCount: 535,
        executedTestCount: 0,
      },
      qualityGateReport: {
        gate: "fast",
        passed: true,
        failedStep: null,
      },
    });

    expect(report).toMatchObject({
      classification: "delegated",
      validationEligible: false,
      potentialFalseNegativeObserved: false,
      potentialFalsePositiveObserved: false,
      observedTestFailureCount: 0,
      falseNegativeRate: null,
      falsePositiveRate: null,
    });
  });

  it("reports missing evidence without claiming a validation sample", () => {
    const report = reconcileImpactEvidence({
      advisoryReport: null,
      qualityGateReport: null,
    });

    expect(report).toMatchObject({
      classification: "missing-evidence",
      validationEligible: false,
      missingEvidence: [
        "artifacts/test-impact-advisory.json",
        "artifacts/quality-gate-fast.json",
      ],
      potentialFalseNegativeObserved: false,
      potentialFalsePositiveObserved: false,
    });
  });

  it("does not validate selection when the authoritative gate never reaches tests", () => {
    const report = reconcileImpactEvidence({
      advisoryReport: {
        status: "passed",
        fallbackToFull: false,
        deferredTestCount: 0,
        selectedTestCount: 5,
        executedTestCount: 5,
      },
      qualityGateReport: {
        gate: "fast",
        passed: false,
        failedStep: "pnpm check:whitespace",
        steps: [{ command: "pnpm check:whitespace", passed: false }],
      },
    });

    expect(report).toMatchObject({
      classification: "authoritative-tests-not-run",
      validationEligible: false,
      authoritativeTestsObserved: false,
      potentialFalseNegativeObserved: false,
      potentialFalsePositiveObserved: false,
    });
  });

  it("persists a stable GitHub Actions sample identity for historical aggregation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-impact-reconcile-"));
    try {
      await writeFile(path.join(root, "advisory.json"), JSON.stringify({
        status: "passed",
        fallbackToFull: false,
        deferredTestCount: 0,
        selectedTestCount: 4,
        executedTestCount: 4,
      }));
      await writeFile(path.join(root, "gate.json"), JSON.stringify({
        gate: "fast",
        passed: true,
        failedStep: null,
      }));

      await writeImpactReconciliation({
        rootPath: root,
        advisoryPath: "advisory.json",
        gatePath: "gate.json",
        reportPath: "report.json",
        environment: {
          GITHUB_RUN_ID: "314",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_SHA: "abc123",
          GITHUB_REF_NAME: "feature/tdd",
          GITHUB_EVENT_NAME: "pull_request",
        },
      });
      const report = JSON.parse(await readFile(path.join(root, "report.json"), "utf8"));

      expect(report).toMatchObject({
        sampleId: "github-actions:314:2",
        run: {
          provider: "github-actions",
          runId: "314",
          runAttempt: 2,
          commitSha: "abc123",
          ref: "feature/tdd",
          eventName: "pull_request",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks controlled failure samples without colliding with production run evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-impact-calibration-"));
    try {
      await writeFile(path.join(root, "advisory.json"), JSON.stringify({
        status: "failed",
        fallbackToFull: false,
        deferredTestCount: 0,
        selectedTestCount: 1,
        executedTestCount: 1,
        results: [{ failedTests: ["controlled failure identity"] }],
      }));
      await writeFile(path.join(root, "gate.json"), JSON.stringify({
        gate: "controlled-failure",
        passed: false,
        failedStep: "pnpm test:impact:calibration",
        steps: [{
          command: "pnpm test:impact:calibration",
          passed: false,
          failedTests: ["controlled failure identity"],
        }],
      }));

      const report = await writeImpactReconciliation({
        rootPath: root,
        advisoryPath: "advisory.json",
        gatePath: "gate.json",
        reportPath: "report.json",
        sampleKind: "controlled-failure",
        sampleIdSuffix: "calibration",
        environment: {
          GITHUB_RUN_ID: "315",
          GITHUB_RUN_ATTEMPT: "1",
        },
      });

      expect(report).toMatchObject({
        classification: "confirmed-failure",
        sampleKind: "controlled-failure",
        sampleId: "github-actions:315:1:calibration",
        comparisonPrecision: "runner-output",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
