import { performance } from "node:perf_hooks";
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchSessionQueryInput } from "@/components/layout/SearchSessionQueryInput";
import { createDocumentLoadCoordinator } from "@/features/documents/document-load-coordinator";
import { createDocumentStore } from "@/features/documents/document-store";
import { buildDocumentText } from "@/features/documents/document-text-builder";
import { createNavigationTransactionRuntime } from "@/features/navigation/navigation-transaction-runtime";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("runtime interaction soak", () => {
  it("keeps search type delete close soak bounded on the product input path", async () => {
    vi.useFakeTimers();
    const projectFileCount = envNumber("ARKLINE_SOAK_FILE_COUNT", 5_000);
    const operationCount = envNumber("ARKLINE_SOAK_SEARCH_OPERATIONS", 100);
    const targetMs = envNumber("ARKLINE_SOAK_SEARCH_TARGET_MS", 50);
    const candidates = searchCandidates(50);
    const values = typeDeleteValues("EntryAbility");
    const samples: number[] = [];
    let renderCommits = 0;
    let draftCount = 0;
    let commitCount = 0;
    let cancelCount = 0;
    const heapBefore = process.memoryUsage().heapUsed;

    for (let sessionIndex = 0; samples.length < operationCount; sessionIndex += 1) {
      const store = createSearchSessionStore();
      const runtime = createSearchInteractionRuntime({ cancel: () => { cancelCount += 1; } });
      const mode = sessionIndex % 2 === 0 ? "searchEverywhere" : "find";
      const view = render(
        <Profiler id="search-soak" onRender={() => { renderCommits += 1; }}>
          <SearchSessionQueryInput
            label={`Search Soak ${sessionIndex}`}
            mode={mode}
            query=""
            placeholder="Search"
            onDraftChange={(query) => {
              draftCount += 1;
              runtime.startQuery(mode === "find" ? "text" : "searchEverywhere");
              store.clear(query);
            }}
            onCommit={(query) => {
              commitCount += 1;
              runtime.startQuery(mode === "find" ? "text" : "searchEverywhere");
              store.patch({ candidates, result: { query: { kind: "text", query }, matches: [] } });
            }}
          />
        </Profiler>,
      );
      const input = within(view.container).getByLabelText(`Search Soak ${sessionIndex}`);
      const sessionValues = sessionIndex % 2 === 0 ? values : values.slice(0, -1);
      for (const value of sessionValues) {
        if (samples.length >= operationCount) break;
        const started = performance.now();
        fireEvent.change(input, { target: { value } });
        samples.push(performance.now() - started);
      }
      if (sessionIndex % 2 === 0) {
        runtime.invalidateForeground();
        store.clear();
        view.unmount();
        act(() => vi.advanceTimersByTime(200));
      } else {
        act(() => vi.advanceTimersByTime(250));
        runtime.invalidateForeground();
        view.unmount();
      }
    }

    const staleRuntime = createSearchInteractionRuntime();
    const staleRequest = deferred<SearchCandidate[]>();
    let staleApplyCount = 0;
    const generation = staleRuntime.startQuery("searchEverywhere");
    const tracked = staleRuntime.trackQuery({
      generation,
      request: staleRequest.promise,
      apply: () => { staleApplyCount += 1; },
    });
    staleRuntime.invalidateForeground();
    staleRequest.resolve(candidates);
    await tracked;

    const summary = summarize(samples);
    report({
      scenario: "search-type-delete-close",
      projectFileCount,
      operations: samples.length,
      candidateCount: candidates.length,
      draftCount,
      commitCount,
      cancelCount,
      staleApplyCount,
      renderCommits,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      targetP95Ms: targetMs,
      ...summary,
    });
    expect(draftCount).toBe(operationCount);
    expect(commitCount).toBeGreaterThan(0);
    expect(commitCount).toBeLessThan(Math.ceil(operationCount / values.length));
    expect(cancelCount).toBeGreaterThan(0);
    expect(staleApplyCount).toBe(0);
    expect(renderCommits).toBeLessThanOrEqual(operationCount + Math.ceil(operationCount / values.length) * 3);
    if (strictGate()) expect(summary.p95Ms).toBeLessThanOrEqual(targetMs);
  });

  it("keeps file switch and jump soak latest-wins and bounded", async () => {
    const fileCount = envNumber("ARKLINE_SOAK_FILE_COUNT", 5_000);
    const switchCount = envNumber("ARKLINE_SOAK_SWITCHES", 50);
    const targetMs = envNumber("ARKLINE_SOAK_FILE_TARGET_MS", 300);
    const paths = Array.from(
      { length: fileCount },
      (_, index) => `/workspace/entry/src/main/ets/pages/Page${index}.ets`,
    );
    const coordinator = createDocumentLoadCoordinator();
    const documents = createDocumentStore();
    const navigation = createNavigationTransactionRuntime();
    const switchSamples: number[] = [];
    const jumpDispatchSamples: number[] = [];
    let notificationCount = 0;
    let readCount = 0;
    let staleJumpCount = 0;
    let appliedJumpCount = 0;
    const heapBefore = process.memoryUsage().heapUsed;
    documents.subscribe(() => { notificationCount += 1; });

    for (let index = 0; index < switchCount; index += 1) {
      const path = paths[(index * 97) % paths.length]!;
      const transaction = navigation.start(path);
      const started = performance.now();
      const content = await coordinator.load(path, async () => {
        readCount += 1;
        return sourceContent(index);
      });
      const text = await buildDocumentText(content, { yieldTask: async () => undefined });
      if (navigation.isCurrent(transaction.id)) {
        documents.openDocumentText(path, content, text);
        navigation.finish(transaction.id);
      }
      switchSamples.push(performance.now() - started);
    }

    const jumpCount = Math.min(50, Math.max(10, switchCount));
    const jumpRequests = Array.from({ length: jumpCount }, (_, index) => deferred<string>());
    const jumpTasks = jumpRequests.map((request, index) => {
      const path = `/workspace/jump/Target${index}.ets`;
      const started = performance.now();
      const transaction = navigation.start(path);
      const load = coordinator.load(path, () => request.promise).then(async (content) => {
        if (!navigation.isCurrent(transaction.id)) {
          staleJumpCount += 1;
          return;
        }
        const text = await buildDocumentText(content, { yieldTask: async () => undefined });
        if (!navigation.isCurrent(transaction.id)) {
          staleJumpCount += 1;
          return;
        }
        documents.openDocumentText(path, content, text);
        appliedJumpCount += 1;
        navigation.finish(transaction.id);
      });
      jumpDispatchSamples.push(performance.now() - started);
      return load;
    });
    for (let index = jumpRequests.length - 1; index >= 0; index -= 1) {
      jumpRequests[index]!.resolve(sourceContent(index));
      await Promise.resolve();
    }
    await Promise.all(jumpTasks);
    await Promise.resolve();

    const switchSummary = summarize(switchSamples);
    const jumpSummary = summarize(jumpDispatchSamples);
    report({
      scenario: "file-switch-jump",
      fileCount,
      switches: switchCount,
      jumpCount,
      readCount,
      cacheEntries: coordinator.cacheSize(),
      pendingLoads: coordinator.pendingCount(),
      notificationCount,
      staleJumpCount,
      appliedJumpCount,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      targetP95Ms: targetMs,
      switchP50Ms: switchSummary.p50Ms,
      switchP95Ms: switchSummary.p95Ms,
      switchP99Ms: switchSummary.p99Ms,
      jumpDispatchP95Ms: jumpSummary.p95Ms,
    });
    expect(coordinator.pendingCount()).toBe(0);
    expect(coordinator.cacheSize()).toBeLessThanOrEqual(16);
    expect(appliedJumpCount).toBe(1);
    expect(staleJumpCount).toBe(jumpCount - 1);
    expect(documents.getDocument(`/workspace/jump/Target${jumpCount - 1}.ets`)).toBeDefined();
    if (strictGate()) expect(switchSummary.p95Ms).toBeLessThanOrEqual(targetMs);
  });
});

function sourceContent(seed: number) {
  return Array.from(
    { length: 120 },
    (_, line) => `  method${line}() { return ${seed + line}; }`,
  ).join("\n");
}

function typeDeleteValues(value: string) {
  const typed = Array.from({ length: value.length }, (_, index) => value.slice(0, index + 1));
  const deleted = Array.from({ length: value.length }, (_, index) => value.slice(0, value.length - index - 1));
  return [...typed, ...deleted];
}

function searchCandidates(count: number): SearchCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `candidate-${index}`,
    source: index % 2 === 0 ? "class" : "file",
    kind: index % 2 === 0 ? "class" : "file",
    title: `EntryAbility${index}`,
    subtitle: `EntryAbility${index}.ets`,
    path: `/workspace/EntryAbility${index}.ets`,
    score: count - index,
    freshness: "ready",
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
  };
}

function percentile(sorted: number[], ratio: number) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return Number((sorted[Math.max(0, index)] ?? 0).toFixed(3));
}

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function strictGate() {
  return process.env.ARKLINE_SOAK_STRICT === "1";
}

function report(value: Record<string, string | number>) {
  console.log(`ARKLINE_PERF ${JSON.stringify(value)}`);
}
