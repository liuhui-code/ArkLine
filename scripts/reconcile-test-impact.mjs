#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ADVISORY_REPORT = "artifacts/test-impact-advisory.json";
const DEFAULT_GATE_REPORT = "artifacts/quality-gate-fast.json";
const DEFAULT_REPORT = "artifacts/test-impact-reconciliation.json";

export function reconcileImpactEvidence({ advisoryReport, qualityGateReport }) {
  if (!advisoryReport || !qualityGateReport) {
    return {
      schemaVersion: 1,
      classification: "missing-evidence",
      validationEligible: false,
      authoritativeTestsObserved: false,
      missingEvidence: [
        ...(!advisoryReport ? ["artifacts/test-impact-advisory.json"] : []),
        ...(!qualityGateReport ? ["artifacts/quality-gate-fast.json"] : []),
      ],
      potentialFalseNegativeObserved: false,
      potentialFalsePositiveObserved: false,
      observedTestFailureCount: 0,
      falseNegativeRate: null,
      falsePositiveRate: null,
      comparisonPrecision: "gate-step",
    };
  }
  const delegated = advisoryReport.fallbackToFull || advisoryReport.status === "delegated";
  const authoritativeTestFailure = (
    qualityGateReport.passed === false
    && /^pnpm test(?::|\s|$)/u.test(qualityGateReport.failedStep ?? "")
  );
  const passedGateSteps = new Set((qualityGateReport.steps ?? [])
    .filter((step) => step.passed)
    .map((step) => step.command));
  const authoritativeTestsObserved = (
    qualityGateReport.passed === true
    || authoritativeTestFailure
    || [
      "pnpm test:semantic-worker",
      "pnpm test:frontend:quality",
      "pnpm test:rust",
    ].every((command) => passedGateSteps.has(command))
  );
  const validationEligible = (
    !delegated
    && authoritativeTestsObserved
    && advisoryReport.deferredTestCount === 0
    && advisoryReport.executedTestCount === advisoryReport.selectedTestCount
  );
  const potentialFalseNegativeObserved = (
    validationEligible
    &&
    advisoryReport.status === "passed"
    && authoritativeTestFailure
  );
  const advisoryFailure = validationEligible && advisoryReport.status === "failed";
  const potentialFalsePositiveObserved = advisoryFailure && qualityGateReport.passed === true;
  const failedGateStep = (qualityGateReport.steps ?? []).find((step) => !step.passed);
  const authoritativeFailedTests = failedGateStep?.failedTests ?? [];
  const advisoryFailedTests = (advisoryReport.results ?? [])
    .flatMap((result) => result.failedTests ?? []);
  const observedTestFailureCount = Number(
    validationEligible && (advisoryFailure || authoritativeTestFailure),
  );
  const classification = delegated
    ? "delegated"
    : !authoritativeTestsObserved
      ? "authoritative-tests-not-run"
      : !validationEligible
        ? "incomplete-execution"
        : potentialFalseNegativeObserved
          ? "potential-false-negative"
          : potentialFalsePositiveObserved
            ? "potential-false-positive"
            : advisoryFailure && authoritativeTestFailure
              ? "confirmed-failure"
              : "validated-pass";
  return {
    schemaVersion: 1,
    classification,
    validationEligible,
    authoritativeTestsObserved,
    potentialFalseNegativeObserved,
    potentialFalsePositiveObserved,
    observedTestFailureCount,
    falseNegativeRate: observedTestFailureCount === 0
      ? null
      : Number(potentialFalseNegativeObserved),
    falsePositiveRate: observedTestFailureCount === 0
      ? null
      : Number(potentialFalsePositiveObserved),
    authoritativeFailedTests,
    advisoryFailedTests,
    selectedTestCount: advisoryReport.selectedTestCount,
    executedTestCount: advisoryReport.executedTestCount,
    comparisonPrecision: (
      authoritativeFailedTests.length > 0 || advisoryFailedTests.length > 0
    ) ? "runner-output" : "gate-step",
    advisoryStatus: advisoryReport.status,
    authoritativeGate: qualityGateReport.gate,
    authoritativeGatePassed: qualityGateReport.passed,
  };
}

export async function writeImpactReconciliation({
  rootPath,
  advisoryPath = DEFAULT_ADVISORY_REPORT,
  gatePath = DEFAULT_GATE_REPORT,
  reportPath = DEFAULT_REPORT,
  sampleKind = "production",
  sampleIdSuffix,
  environment = process.env,
}) {
  const [advisoryReport, qualityGateReport] = await Promise.all([
    readOptionalJson(path.resolve(rootPath, advisoryPath)),
    readOptionalJson(path.resolve(rootPath, gatePath)),
  ]);
  const run = buildRunMetadata(environment);
  const report = {
    ...reconcileImpactEvidence({ advisoryReport, qualityGateReport }),
    sampleKind,
    sampleId: run.runId
      ? [run.provider, run.runId, run.runAttempt, sampleIdSuffix].filter(Boolean).join(":")
      : null,
    run,
    generatedAt: new Date().toISOString(),
  };
  const output = path.resolve(rootPath, reportPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function buildRunMetadata(environment) {
  const runId = environment.GITHUB_RUN_ID ?? null;
  return {
    provider: runId ? "github-actions" : "local",
    runId,
    runAttempt: runId ? Number(environment.GITHUB_RUN_ATTEMPT ?? 1) : null,
    commitSha: environment.GITHUB_SHA ?? null,
    ref: environment.GITHUB_REF_NAME ?? null,
    eventName: environment.GITHUB_EVENT_NAME ?? null,
    workflow: environment.GITHUB_WORKFLOW ?? null,
    job: environment.GITHUB_JOB ?? null,
  };
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function parseArgs(argv) {
  return Object.fromEntries(argv.filter((argument) => argument !== "--").map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await writeImpactReconciliation({
      rootPath: process.cwd(),
      advisoryPath: typeof args.advisory === "string" ? args.advisory : DEFAULT_ADVISORY_REPORT,
      gatePath: typeof args.gate === "string" ? args.gate : DEFAULT_GATE_REPORT,
      reportPath: typeof args.report === "string" ? args.report : DEFAULT_REPORT,
    });
    console.log(`ARKLINE_TEST_IMPACT_RECONCILIATION ${JSON.stringify({
      classification: report.classification,
      validationEligible: report.validationEligible,
      potentialFalseNegativeObserved: report.potentialFalseNegativeObserved,
      potentialFalsePositiveObserved: report.potentialFalsePositiveObserved,
    })}`);
  } catch (error) {
    console.error(`[test-impact:reconcile] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
