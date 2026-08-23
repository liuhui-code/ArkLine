import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildImpactPromotionReview,
  renderImpactPromotionReviewMarkdown,
  writeImpactPromotionReview,
} from "../../scripts/review-test-impact-promotion.mjs";

describe("TDD impact promotion review", () => {
  it("keeps insufficient evidence in collection without authorizing a blocking gate", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-impact-review-"));
    try {
      await writeFile(path.join(root, "history.json"), JSON.stringify({
        schemaVersion: 1,
        eligibleSampleCount: 12,
        failureSampleCount: 2,
        identifiedFailureSampleCount: 2,
        potentialFalseNegativeCount: 0,
        potentialFalsePositiveCount: 0,
        falsePositiveRate: 0,
        thresholds: {
          minimumEligibleSamples: 100,
          minimumFailureSamples: 5,
          maximumFalsePositiveRate: 0.05,
        },
        promotionEligible: false,
        promotionBlockers: [
          "insufficient-eligible-samples",
          "insufficient-failure-samples",
        ],
      }));

      const review = await writeImpactPromotionReview({
        rootPath: root,
        historyPath: "history.json",
        reportPath: "review.json",
        markdownPath: "review.md",
      });
      const persisted = JSON.parse(await readFile(path.join(root, "review.json"), "utf8"));
      const markdown = await readFile(path.join(root, "review.md"), "utf8");

      expect(review).toMatchObject({
        schemaVersion: 1,
        status: "collecting",
        recommendedAction: "collect-evidence",
        thresholdQualified: false,
        blockingAuthorized: false,
      });
      expect(persisted).toEqual(review);
      expect(markdown).toContain("# Test Impact Promotion Review");
      expect(markdown).toContain("Status: **collecting**");
      expect(markdown).toContain("Blocking authorized: **no**");
      expect(markdown).toContain("12 / 100");
      expect(markdown).toContain("2 / 5");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks promotion review when a potential false negative is present", () => {
    const review = buildImpactPromotionReview({
      promotionEligible: false,
      promotionBlockers: [
        "potential-false-negatives-observed",
        "unidentified-failure-samples",
      ],
      potentialFalseNegativeCount: 1,
      potentialFalseNegativeSampleIds: ["github-actions:99:1"],
      unidentifiedFailureSampleIds: ["github-actions:98:1"],
    });
    const markdown = renderImpactPromotionReviewMarkdown(review);

    expect(review).toMatchObject({
      status: "blocked",
      recommendedAction: "investigate-evidence",
      thresholdQualified: false,
      blockingAuthorized: false,
      evidence: {
        potentialFalseNegativeCount: 1,
        potentialFalseNegativeSampleIds: ["github-actions:99:1"],
        unidentifiedFailureSampleIds: ["github-actions:98:1"],
        promotionBlockers: [
          "potential-false-negatives-observed",
          "unidentified-failure-samples",
        ],
      },
    });
    expect(markdown).toContain("github-actions:99:1");
    expect(markdown).toContain("github-actions:98:1");
  });

  it("requires human review after every machine threshold is satisfied", () => {
    const review = buildImpactPromotionReview({
      promotionEligible: true,
      promotionBlockers: [],
      eligibleSampleCount: 100,
      failureSampleCount: 5,
      identifiedFailureSampleCount: 5,
      potentialFalseNegativeCount: 0,
      falsePositiveRate: 0,
      thresholds: {
        minimumEligibleSamples: 100,
        minimumFailureSamples: 5,
        maximumFalsePositiveRate: 0.05,
      },
    });
    const markdown = renderImpactPromotionReviewMarkdown(review);

    expect(review).toMatchObject({
      status: "review-required",
      recommendedAction: "request-human-review",
      thresholdQualified: true,
      blockingAuthorized: false,
    });
    expect(markdown).toContain("None; human review is required");
    expect(markdown).toContain("Automated evidence never authorizes a blocking gate");
  });
});
