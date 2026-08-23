#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_HISTORY = "artifacts/test-impact-history.json";
const DEFAULT_REPORT = "artifacts/test-impact-promotion-review.json";
const DEFAULT_MARKDOWN = "artifacts/test-impact-promotion-review.md";

export function buildImpactPromotionReview(history) {
  const thresholdQualified = history.promotionEligible === true;
  const promotionBlockers = history.promotionBlockers ?? [];
  const riskObserved = promotionBlockers.some((blocker) => [
    "potential-false-negatives-observed",
    "false-positive-rate-over-threshold",
    "unidentified-failure-samples",
  ].includes(blocker));
  const status = thresholdQualified ? "review-required" : riskObserved ? "blocked" : "collecting";
  return {
    schemaVersion: 1,
    status,
    recommendedAction: status === "review-required"
      ? "request-human-review"
      : status === "blocked"
        ? "investigate-evidence"
        : "collect-evidence",
    thresholdQualified,
    blockingAuthorized: false,
    evidence: {
      eligibleSampleCount: history.eligibleSampleCount ?? 0,
      failureSampleCount: history.failureSampleCount ?? 0,
      identifiedFailureSampleCount: history.identifiedFailureSampleCount ?? 0,
      potentialFalseNegativeCount: history.potentialFalseNegativeCount ?? 0,
      potentialFalsePositiveCount: history.potentialFalsePositiveCount ?? 0,
      potentialFalseNegativeSampleIds: history.potentialFalseNegativeSampleIds ?? [],
      potentialFalsePositiveSampleIds: history.potentialFalsePositiveSampleIds ?? [],
      unidentifiedFailureSampleIds: history.unidentifiedFailureSampleIds ?? [],
      falsePositiveRate: history.falsePositiveRate ?? null,
      thresholds: history.thresholds ?? {},
      promotionBlockers,
    },
    sourceHistoryGeneratedAt: history.generatedAt ?? null,
  };
}

export function renderImpactPromotionReviewMarkdown(review) {
  const evidence = review.evidence;
  const thresholds = evidence.thresholds;
  const anomalySampleIds = [...new Set([
    ...evidence.potentialFalseNegativeSampleIds,
    ...evidence.potentialFalsePositiveSampleIds,
    ...evidence.unidentifiedFailureSampleIds,
  ])].sort();
  const blockers = evidence.promotionBlockers.length > 0
    ? evidence.promotionBlockers.map((blocker) => `- \`${blocker}\``).join("\n")
    : "- None; human review is required before any gate change.";
  return [
    "# Test Impact Promotion Review",
    "",
    `Status: **${review.status}**`,
    "",
    `Blocking authorized: **${review.blockingAuthorized ? "yes" : "no"}**`,
    "",
    "| Evidence | Current / Required |",
    "| --- | --- |",
    `| Production samples | ${evidence.eligibleSampleCount} / ${thresholds.minimumEligibleSamples ?? "unknown"} |`,
    `| Identity-bearing failure samples | ${evidence.identifiedFailureSampleCount} / ${thresholds.minimumFailureSamples ?? "unknown"} |`,
    `| Potential false negatives | ${evidence.potentialFalseNegativeCount} / 0 |`,
    `| Potential false-positive rate | ${formatRate(evidence.falsePositiveRate)} / ${formatRate(thresholds.maximumFalsePositiveRate)} |`,
    "",
    "## Machine blockers",
    "",
    blockers,
    "",
    "## Anomaly samples",
    "",
    anomalySampleIds.length > 0
      ? anomalySampleIds.map((sampleId) => `- \`${sampleId}\``).join("\n")
      : "- None",
    "",
    "Automated evidence never authorizes a blocking gate. A reviewed change is required.",
    "",
  ].join("\n");
}

export async function writeImpactPromotionReview({
  rootPath,
  historyPath = DEFAULT_HISTORY,
  reportPath = DEFAULT_REPORT,
  markdownPath = DEFAULT_MARKDOWN,
}) {
  const history = JSON.parse(await readFile(path.resolve(rootPath, historyPath), "utf8"));
  const review = {
    ...buildImpactPromotionReview(history),
    generatedAt: new Date().toISOString(),
  };
  const reportOutput = path.resolve(rootPath, reportPath);
  const markdownOutput = path.resolve(rootPath, markdownPath);
  await Promise.all([
    mkdir(path.dirname(reportOutput), { recursive: true }),
    mkdir(path.dirname(markdownOutput), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(reportOutput, `${JSON.stringify(review, null, 2)}\n`, "utf8"),
    writeFile(markdownOutput, renderImpactPromotionReviewMarkdown(review), "utf8"),
  ]);
  return review;
}

function formatRate(rate) {
  return typeof rate === "number" ? `${(rate * 100).toFixed(1)}%` : "n/a";
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
    const review = await writeImpactPromotionReview({
      rootPath: process.cwd(),
      historyPath: typeof args.history === "string" ? args.history : DEFAULT_HISTORY,
      reportPath: typeof args.report === "string" ? args.report : DEFAULT_REPORT,
      markdownPath: typeof args.markdown === "string" ? args.markdown : DEFAULT_MARKDOWN,
    });
    console.log(`ARKLINE_TEST_IMPACT_PROMOTION_REVIEW ${JSON.stringify({
      status: review.status,
      thresholdQualified: review.thresholdQualified,
      blockingAuthorized: review.blockingAuthorized,
      promotionBlockers: review.evidence.promotionBlockers,
    })}`);
  } catch (error) {
    console.error(`[test-impact:review] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
