#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractFailedTestIdentities } from "./run-quality-gate.mjs";
import { writeImpactReconciliation } from "./reconcile-test-impact.mjs";

const FIXTURE = "tests/frontend/test-impact-calibration-fixture.test.ts";
const DEFAULT_REPORT = "artifacts/test-impact-history/calibration/test-impact-reconciliation.json";
const EXPECTED_IDENTITY = "emits a controlled failure identity";

export async function writeControlledFailureEvidence({
  rootPath,
  reportPath = DEFAULT_REPORT,
  environment = process.env,
  execute = runCalibrationFixture,
  echoOutput = false,
}) {
  const result = execute({ rootPath, environment });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (echoOutput) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  if (result.error) throw result.error;
  if (result.status !== 1 || result.signal) {
    throw new Error(`controlled failure fixture exited unexpectedly: status=${result.status} signal=${result.signal ?? "none"}`);
  }
  const failedTests = extractFailedTestIdentities(`${stdout}\n${stderr}`);
  if (!failedTests.some((identity) => identity.includes(EXPECTED_IDENTITY))) {
    throw new Error("controlled failure identity was not captured from runner output");
  }

  const evidenceDirectory = path.resolve(rootPath, "artifacts/test-impact-calibration");
  const advisoryPath = path.join(evidenceDirectory, "advisory.json");
  const gatePath = path.join(evidenceDirectory, "gate.json");
  await mkdir(evidenceDirectory, { recursive: true });
  await Promise.all([
    writeFile(advisoryPath, `${JSON.stringify({
      status: "failed",
      fallbackToFull: false,
      deferredTestCount: 0,
      selectedTestCount: 1,
      executedTestCount: 1,
      results: [{ failedTests, failureIdentityPrecision: "runner-output" }],
    }, null, 2)}\n`, "utf8"),
    writeFile(gatePath, `${JSON.stringify({
      gate: "controlled-failure",
      passed: false,
      failedStep: "pnpm test:impact:calibration",
      steps: [{
        command: "pnpm test:impact:calibration",
        passed: false,
        failedTests,
        failureIdentityPrecision: "runner-output",
      }],
    }, null, 2)}\n`, "utf8"),
  ]);

  return writeImpactReconciliation({
    rootPath,
    advisoryPath: path.relative(rootPath, advisoryPath),
    gatePath: path.relative(rootPath, gatePath),
    reportPath,
    sampleKind: "controlled-failure",
    sampleIdSuffix: "calibration",
    environment,
  });
}

function runCalibrationFixture({ rootPath, environment }) {
  return spawnSync(
    "pnpm",
    ["exec", "vitest", "run", FIXTURE, "--reporter=default"],
    {
      cwd: rootPath,
      env: {
        ...environment,
        ARKLINE_TDD_CONTROLLED_FAILURE: "1",
        NO_COLOR: "1",
      },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
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
    const report = await writeControlledFailureEvidence({
      rootPath: process.cwd(),
      reportPath: typeof args.report === "string" ? args.report : DEFAULT_REPORT,
      echoOutput: true,
    });
    console.log(`ARKLINE_TEST_IMPACT_CALIBRATION ${JSON.stringify({
      sampleId: report.sampleId,
      classification: report.classification,
      failedTests: report.authoritativeFailedTests,
    })}`);
  } catch (error) {
    console.error(`[test-impact:calibration] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
