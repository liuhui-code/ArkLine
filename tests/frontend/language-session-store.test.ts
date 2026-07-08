import { describe, expect, it } from "vitest";
import { createLanguageSessionStore } from "@/features/language/language-session-store";

describe("language session store", () => {
  it("marks older sessions stale when a new request starts", () => {
    const store = createLanguageSessionStore();
    const first = store.begin("completion", "completion:typing", 2500, 10);
    const second = store.begin("completion", "completion:typing", 2500, 20);

    expect(store.isCurrent(first)).toBe(false);
    expect(store.isCurrent(second)).toBe(true);
    expect(second.generation).toBeGreaterThan(first.generation);
  });

  it("cancels active sessions by kind", () => {
    const store = createLanguageSessionStore();
    const session = store.begin("definition", "definition:editor", 3000, 10);

    store.cancel("definition");

    expect(store.isCurrent(session)).toBe(false);
    expect(store.snapshot()).toEqual([]);
  });
});
