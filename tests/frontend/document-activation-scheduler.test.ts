import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_ACTIVATION_YIELD_THRESHOLD,
  scheduleDocumentActivation,
  shouldYieldDocumentActivation,
} from "@/features/documents/document-activation-scheduler";

describe("document activation scheduler", () => {
  it("yields cached previews and large documents", () => {
    expect(shouldYieldDocumentActivation({ cached: true, contentLength: 1 })).toBe(true);
    expect(shouldYieldDocumentActivation({
      cached: false,
      contentLength: DOCUMENT_ACTIVATION_YIELD_THRESHOLD,
    })).toBe(true);
    expect(shouldYieldDocumentActivation({
      cached: false,
      contentLength: DOCUMENT_ACTIVATION_YIELD_THRESHOLD - 1,
    })).toBe(false);
  });

  it("uses the browser scheduling API when available", async () => {
    const yieldTask = vi.fn(async () => undefined);
    const setTimeout = vi.fn();

    await scheduleDocumentActivation(
      { cached: true, contentLength: 1 },
      { scheduler: { yield: yieldTask }, setTimeout },
    );

    expect(yieldTask).toHaveBeenCalledTimes(1);
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it("falls back to a new browser task", async () => {
    const setTimeout = vi.fn((callback: () => void) => {
      callback();
      return 1;
    });

    await scheduleDocumentActivation(
      { cached: false, contentLength: DOCUMENT_ACTIVATION_YIELD_THRESHOLD },
      { setTimeout },
    );

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
  });
});
