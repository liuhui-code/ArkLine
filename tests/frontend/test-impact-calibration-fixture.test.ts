import { describe, expect, it } from "vitest";

describe("Test impact calibration", () => {
  it("emits a controlled failure identity", () => {
    expect(process.env.ARKLINE_TDD_CONTROLLED_FAILURE).not.toBe("1");
  });
});
