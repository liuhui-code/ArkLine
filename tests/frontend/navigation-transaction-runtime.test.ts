import { describe, expect, it } from "vitest";
import { createNavigationTransactionRuntime } from "@/features/navigation/navigation-transaction-runtime";

describe("navigation transaction runtime", () => {
  it("starts a current transaction for a target path", () => {
    const runtime = createNavigationTransactionRuntime();

    const transaction = runtime.start("/workspace/A.ets");

    expect(runtime.isCurrent(transaction.id)).toBe(true);
    expect(runtime.getCurrent()).toEqual(transaction);
  });

  it("invalidates an older transaction when a newer one starts", () => {
    const runtime = createNavigationTransactionRuntime();

    const first = runtime.start("/workspace/A.ets");
    const second = runtime.start("/workspace/B.ets");

    expect(runtime.isCurrent(first.id)).toBe(false);
    expect(runtime.isCurrent(second.id)).toBe(true);
  });

  it("clears the current transaction when it finishes", () => {
    const runtime = createNavigationTransactionRuntime();
    const transaction = runtime.start("/workspace/A.ets");

    runtime.finish(transaction.id);

    expect(runtime.isCurrent(transaction.id)).toBe(false);
    expect(runtime.getCurrent()).toBeNull();
  });

  it("does not clear a newer transaction when an older one finishes", () => {
    const runtime = createNavigationTransactionRuntime();
    const first = runtime.start("/workspace/A.ets");
    const second = runtime.start("/workspace/B.ets");

    runtime.finish(first.id);

    expect(runtime.getCurrent()).toEqual(second);
  });
});
