import { describe, expect, it } from "vitest";
import { aggregateImpactHistory } from "../../scripts/aggregate-test-impact.mjs";

function sample(sampleId: string, classification: string) {
  return {
    sampleId,
    classification,
    validationEligible: true,
    potentialFalseNegativeObserved: classification === "potential-false-negative",
    potentialFalsePositiveObserved: classification === "potential-false-positive",
    observedTestFailureCount: classification === "validated-pass" ? 0 : 1,
  };
}

describe("TDD impact history", () => {
  it("deduplicates CI samples and computes failure-bearing false-negative rates", () => {
    const report = aggregateImpactHistory([
      sample("github-actions:1:1", "validated-pass"),
      sample("github-actions:2:1", "confirmed-failure"),
      sample("github-actions:3:1", "potential-false-negative"),
      sample("github-actions:3:1", "potential-false-negative"),
    ]);

    expect(report).toMatchObject({
      schemaVersion: 1,
      totalReportCount: 4,
      uniqueSampleCount: 3,
      duplicateSampleCount: 1,
      eligibleSampleCount: 3,
      failureSampleCount: 2,
      potentialFalseNegativeCount: 1,
      potentialFalsePositiveCount: 0,
      potentialFalseNegativeSampleIds: ["github-actions:3:1"],
      potentialFalsePositiveSampleIds: [],
      unidentifiedFailureSampleIds: ["github-actions:2:1", "github-actions:3:1"],
      falseNegativeRate: 0.5,
      falsePositiveRate: 0,
    });
  });

  it("allows promotion only after enough eligible and identity-bearing failure samples", () => {
    const reports = Array.from({ length: 100 }, (_, index) => ({
      ...sample(
        `github-actions:${index + 1}:1`,
        index < 5 ? "confirmed-failure" : "validated-pass",
      ),
      comparisonPrecision: index < 5 ? "runner-output" : "gate-step",
      authoritativeFailedTests: index < 5 ? [`test-${index}`] : [],
    }));

    const report = aggregateImpactHistory(reports);

    expect(report).toMatchObject({
      eligibleSampleCount: 100,
      failureSampleCount: 5,
      identifiedFailureSampleCount: 5,
      promotionEligible: true,
      promotionBlockers: [],
      thresholds: {
        minimumEligibleSamples: 100,
        minimumFailureSamples: 5,
        maximumFalsePositiveRate: 0.05,
      },
    });
  });

  it("excludes unidentified local reports from CI promotion evidence", () => {
    const report = aggregateImpactHistory([{
      ...sample("", "validated-pass"),
      sampleId: null,
    }]);

    expect(report).toMatchObject({
      totalReportCount: 1,
      uniqueSampleCount: 0,
      unidentifiedReportCount: 1,
      eligibleSampleCount: 0,
      promotionEligible: false,
    });
  });

  it("uses controlled failures to calibrate detection without inflating production coverage", () => {
    const production = Array.from({ length: 100 }, (_, index) => ({
      ...sample(`github-actions:${index + 1}:1`, "validated-pass"),
      sampleKind: "production",
    }));
    const controlled = Array.from({ length: 5 }, (_, index) => ({
      ...sample(`github-actions:${index + 101}:1:calibration`, "confirmed-failure"),
      sampleKind: "controlled-failure",
      comparisonPrecision: "runner-output",
      authoritativeFailedTests: [`controlled-failure-${index}`],
    }));

    const report = aggregateImpactHistory([...production, ...controlled]);

    expect(report).toMatchObject({
      eligibleSampleCount: 100,
      productionFailureSampleCount: 0,
      controlledFailureSampleCount: 5,
      failureSampleCount: 5,
      promotionEligible: true,
      promotionBlockers: [],
    });
  });
});
