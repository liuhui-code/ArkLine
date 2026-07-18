import { describe, expect, it, vi } from "vitest";
import { createDocumentLoadCoordinator } from "@/features/documents/document-load-coordinator";

describe("document load coordinator", () => {
  it("shares a pending load across equivalent path forms", async () => {
    const coordinator = createDocumentLoadCoordinator();
    const readFile = vi.fn(async () => "content");

    const [first, second] = await Promise.all([
      coordinator.load("C:/workspace/Entry.ets", readFile),
      coordinator.load("C:\\workspace\\Entry.ets", readFile),
    ]);

    expect(first).toBe("content");
    expect(second).toBe("content");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(coordinator.pendingCount()).toBe(0);
  });

  it("reuses a recent prefetched document without another backend read", async () => {
    const coordinator = createDocumentLoadCoordinator();
    const readFile = vi.fn(async () => "content");

    await coordinator.load("/workspace/Entry.ets", readFile);
    const content = await coordinator.load("/workspace/Entry.ets", readFile);

    expect(content).toBe("content");
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(coordinator.cacheSize()).toBe(1);
  });

  it("expires cached content before it can become a long-lived disk snapshot", async () => {
    let now = 0;
    const coordinator = createDocumentLoadCoordinator({ cacheTtlMs: 100, now: () => now });
    const readFile = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    expect(await coordinator.load("/workspace/Entry.ets", readFile)).toBe("first");
    now = 101;
    expect(await coordinator.load("/workspace/Entry.ets", readFile)).toBe("second");
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
