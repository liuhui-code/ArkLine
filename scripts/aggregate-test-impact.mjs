#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_INPUT = "artifacts/test-impact-history";
const DEFAULT_REPORT = "artifacts/test-impact-history.json";

export function aggregateImpactHistory(reports, {
  minimumEligibleSamples = 100,
  minimumFailureSamples = 5,
  maximumFalsePositiveRate = 0.05,
} = {}) {
  const identifiedReports = reports.filter((report) => (
    typeof report.sampleId === "string" && report.sampleId.length > 0
  ));
  const unique = new Map();
  for (const report of identifiedReports) {
    if (!unique.has(report.sampleId)) unique.set(report.sampleId, report);
  }
  const samples = [...unique.values()];
  const productionSamples = samples.filter((sample) => sample.sampleKind !== "controlled-failure");
  const eligible = productionSamples.filter((sample) => sample.validationEligible);
  const controlled = samples.filter((sample) => (
    sample.sampleKind === "controlled-failure" && sample.validationEligible
  ));
  const productionFailures = eligible.filter((sample) => sample.observedTestFailureCount > 0);
  const controlledFailures = controlled.filter((sample) => sample.observedTestFailureCount > 0);
  const failureSamples = [...productionFailures, ...controlledFailures];
  const potentialFalseNegativeSamples = failureSamples
    .filter((sample) => sample.potentialFalseNegativeObserved);
  const potentialFalsePositiveSamples = failureSamples
    .filter((sample) => sample.potentialFalsePositiveObserved);
  const potentialFalseNegativeCount = potentialFalseNegativeSamples.length;
  const potentialFalsePositiveCount = potentialFalsePositiveSamples.length;
  const identifiedFailureSamples = failureSamples.filter((sample) => (
    sample.comparisonPrecision === "runner-output"
    && [
      ...(sample.authoritativeFailedTests ?? []),
      ...(sample.advisoryFailedTests ?? []),
    ].length > 0
  ));
  const identifiedFailureSampleCount = identifiedFailureSamples.length;
  const identifiedFailureSampleIds = new Set(
    identifiedFailureSamples.map((sample) => sample.sampleId),
  );
  const falseNegativeRate = failureSamples.length === 0
    ? null
    : potentialFalseNegativeCount / failureSamples.length;
  const falsePositiveRate = failureSamples.length === 0
    ? null
    : potentialFalsePositiveCount / failureSamples.length;
  const promotionBlockers = [
    ...(eligible.length < minimumEligibleSamples ? ["insufficient-eligible-samples"] : []),
    ...(failureSamples.length < minimumFailureSamples ? ["insufficient-failure-samples"] : []),
    ...(potentialFalseNegativeCount > 0 ? ["potential-false-negatives-observed"] : []),
    ...(falsePositiveRate !== null && falsePositiveRate > maximumFalsePositiveRate
      ? ["false-positive-rate-over-threshold"]
      : []),
    ...(identifiedFailureSampleCount < failureSamples.length
      ? ["unidentified-failure-samples"]
      : []),
  ];

  return {
    schemaVersion: 1,
    totalReportCount: reports.length,
    uniqueSampleCount: samples.length,
    duplicateSampleCount: identifiedReports.length - samples.length,
    unidentifiedReportCount: reports.length - identifiedReports.length,
    eligibleSampleCount: eligible.length,
    failureSampleCount: failureSamples.length,
    productionFailureSampleCount: productionFailures.length,
    controlledFailureSampleCount: controlledFailures.length,
    identifiedFailureSampleCount,
    potentialFalseNegativeCount,
    potentialFalsePositiveCount,
    potentialFalseNegativeSampleIds: potentialFalseNegativeSamples
      .map((sample) => sample.sampleId).sort(),
    potentialFalsePositiveSampleIds: potentialFalsePositiveSamples
      .map((sample) => sample.sampleId).sort(),
    unidentifiedFailureSampleIds: failureSamples
      .filter((sample) => !identifiedFailureSampleIds.has(sample.sampleId))
      .map((sample) => sample.sampleId).sort(),
    falseNegativeRate,
    falsePositiveRate,
    thresholds: {
      minimumEligibleSamples,
      minimumFailureSamples,
      maximumFalsePositiveRate,
    },
    promotionEligible: promotionBlockers.length === 0,
    promotionBlockers,
  };
}

export async function writeImpactHistory({
  rootPath,
  inputPath = DEFAULT_INPUT,
  reportPath = DEFAULT_REPORT,
  thresholds,
}) {
  const source = path.resolve(rootPath, inputPath);
  const files = await collectJsonFiles(source);
  const reports = [];
  for (const filePath of files) {
    const report = JSON.parse(await readFile(filePath, "utf8"));
    if (report && typeof report === "object" && "classification" in report) {
      reports.push(report);
    }
  }
  const report = {
    ...aggregateImpactHistory(reports, thresholds),
    sourcePath: inputPath,
    generatedAt: new Date().toISOString(),
  };
  const output = path.resolve(rootPath, reportPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function collectJsonFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsonFiles(entryPath));
    } else if (entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files.sort();
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
    const report = await writeImpactHistory({
      rootPath: process.cwd(),
      inputPath: typeof args.dir === "string" ? args.dir : DEFAULT_INPUT,
      reportPath: typeof args.report === "string" ? args.report : DEFAULT_REPORT,
      thresholds: {
        minimumEligibleSamples: Number(args["minimum-eligible"] ?? 100),
        minimumFailureSamples: Number(args["minimum-failures"] ?? 5),
        maximumFalsePositiveRate: Number(args["maximum-false-positive-rate"] ?? 0.05),
      },
    });
    console.log(`ARKLINE_TEST_IMPACT_HISTORY ${JSON.stringify({
      uniqueSampleCount: report.uniqueSampleCount,
      eligibleSampleCount: report.eligibleSampleCount,
      failureSampleCount: report.failureSampleCount,
      promotionEligible: report.promotionEligible,
      promotionBlockers: report.promotionBlockers,
    })}`);
  } catch (error) {
    console.error(`[test-impact:history] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
