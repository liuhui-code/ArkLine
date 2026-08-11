import { describe, expect, it } from "vitest";
import {
  isPackagedSoakDeadlineExceeded,
  runWithinDeadline,
} from "../../scripts/packaged-soak-deadline.mjs";

describe("packaged soak deadline", () => {
  it("returns completed work before the shared deadline", async () => {
    await expect(runWithinDeadline(
      async () => "ready",
      Date.now() + 1_000,
      "interaction cycle",
    )).resolves.toBe("ready");
  });

  it("interrupts a hanging operation at the shared deadline", async () => {
    await expect(runWithinDeadline(
      () => new Promise(() => undefined),
      Date.now() + 5,
      "interaction cycle",
    )).rejects.toMatchObject({
      name: "PackagedSoakDeadlineExceeded",
      message: "Packaged soak deadline exceeded during interaction cycle",
    });
  });

  it("recognizes an expired deadline without starting more work", async () => {
    await expect(runWithinDeadline(
      async () => "not reached",
      Date.now() - 1,
      "periodic evidence",
    )).rejects.toSatisfy(isPackagedSoakDeadlineExceeded);
  });
});
