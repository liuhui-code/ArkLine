# ArkLine Build Run Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add build run summary selectors that convert build history, queue, current run, and event logs into stable view models for future Build UI surfaces.

**Architecture:** Add a pure `build-run-summary` module. It derives summaries from `BuildState` without adding new store state, so future Build History UI can consume stable data while the domain stays single-source-of-truth.

**Tech Stack:** TypeScript, Vitest, existing build store/model.

---

### Task 1: Add Build Run Summary Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Import summary selector**

Add:

```ts
import { listBuildRunSummaries } from "@/features/build/build-run-summary";
```

- [ ] **Step 2: Add summary test**

Add this test inside `describe("build store", ...)`:

```ts
it("summarizes current queued and completed build runs", () => {
  const store = createBuildStore();
  const plan = planHarmonyBuildCommand({
    rootPath: "/workspace/Demo",
    target: "hap",
    moduleName: "entry",
    product: "default",
    buildMode: "debug",
    clean: false,
    fastMode: false,
  });
  const queuedPlan = planHarmonyBuildCommand({
    rootPath: "/workspace/Demo",
    target: "app",
    moduleName: null,
    product: "default",
    buildMode: "release",
    clean: false,
    fastMode: false,
  });

  store.enqueue({ runId: "build-queued", plan: queuedPlan, requestedAt: 100 });
  store.start({ ...plan, runId: "build-running" });

  expect(listBuildRunSummaries(store.state).map((summary) => ({
    runId: summary.runId,
    label: summary.label,
    status: summary.status,
    eventCount: summary.eventCount,
  }))).toEqual([
    {
      runId: "build-running",
      label: "Build HAP entry debug",
      status: "running",
      eventCount: 1,
    },
    {
      runId: "build-queued",
      label: "Build APP project release",
      status: "queued",
      eventCount: 1,
    },
  ]);

  store.finish(createBuildResultFromTerminalRun({
    runId: "build-running",
    exitCode: 0,
    durationMs: 1200,
    stdout: "BUILD SUCCESSFUL",
    stderr: "",
    problems: [],
    artifacts: [{
      path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
      kind: "hap",
      source: "output",
    }],
    environment: createBuildEnvironmentSnapshot({ plan }),
  }));

  expect(listBuildRunSummaries(store.state)[0]).toMatchObject({
    runId: "build-running",
    label: "Build HAP entry debug",
    status: "success",
    durationMs: 1200,
    diagnosticCount: 0,
    artifactCount: 1,
    eventCount: 3,
  });
});
```

- [ ] **Step 3: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because `build-run-summary` does not exist yet.

---

### Task 2: Implement Build Run Summary Selector

**Files:**
- Create: `src/features/build/build-run-summary.ts`

- [ ] **Step 1: Create summary module**

Create `src/features/build/build-run-summary.ts`:

```ts
import type { BuildEvent, BuildQueueItem, BuildResult, BuildState } from "@/features/build/build-model";

export type BuildRunSummaryStatus = "queued" | "running" | BuildResult["status"];

export type BuildRunSummary = {
  runId: string;
  label: string;
  status: BuildRunSummaryStatus;
  target: BuildResult["environment"] extends infer Environment
    ? Environment extends { target: infer Target }
      ? Target
      : string
    : string;
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  durationMs: number | null;
  diagnosticCount: number;
  artifactCount: number;
  artifactPaths: string[];
  eventCount: number;
};

function eventsForRun(events: BuildEvent[], runId: string) {
  return events.filter((event) => event.runId === runId);
}

function summaryFromQueueItem(item: BuildQueueItem, events: BuildEvent[]): BuildRunSummary {
  return {
    runId: item.runId,
    label: item.plan.label,
    status: "queued",
    target: item.plan.intent.target,
    moduleName: item.plan.intent.moduleName,
    product: item.plan.intent.product,
    buildMode: item.plan.intent.buildMode,
    durationMs: null,
    diagnosticCount: 0,
    artifactCount: 0,
    artifactPaths: [],
    eventCount: eventsForRun(events, item.runId).length,
  };
}

function summaryFromCurrentRun(state: BuildState): BuildRunSummary | null {
  if (!state.currentRun?.runId) {
    return null;
  }

  return {
    runId: state.currentRun.runId,
    label: state.currentRun.label,
    status: "running",
    target: state.currentRun.intent.target,
    moduleName: state.currentRun.intent.moduleName,
    product: state.currentRun.intent.product,
    buildMode: state.currentRun.intent.buildMode,
    durationMs: null,
    diagnosticCount: 0,
    artifactCount: 0,
    artifactPaths: [],
    eventCount: eventsForRun(state.events, state.currentRun.runId).length,
  };
}

function summaryFromResult(result: BuildResult, events: BuildEvent[]): BuildRunSummary {
  return {
    runId: result.runId,
    label: result.environment
      ? `Build ${result.environment.target.toUpperCase()} ${result.environment.moduleName ?? "project"} ${result.environment.buildMode}`
      : `Build ${result.runId}`,
    status: result.status,
    target: result.environment?.target ?? "unknown",
    moduleName: result.environment?.moduleName ?? null,
    product: result.environment?.product ?? "default",
    buildMode: result.environment?.buildMode ?? "debug",
    durationMs: result.durationMs,
    diagnosticCount: result.diagnostics.length,
    artifactCount: result.artifacts.length,
    artifactPaths: result.artifacts.map((artifact) => artifact.path),
    eventCount: eventsForRun(events, result.runId).length,
  };
}

export function listBuildRunSummaries(state: BuildState): BuildRunSummary[] {
  const summaries: BuildRunSummary[] = [];
  const current = summaryFromCurrentRun(state);
  if (current) {
    summaries.push(current);
  }

  state.queue.forEach((item) => {
    summaries.push(summaryFromQueueItem(item, state.events));
  });

  state.history.forEach((result) => {
    if (result.runId !== state.currentRun?.runId) {
      summaries.push(summaryFromResult(result, state.events));
    }
  });

  return summaries;
}
```

- [ ] **Step 2: Run focused tests**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: PASS.

---

### Task 3: Full Verification and Commit

**Files:**
- Modified files from Tasks 1-2

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-arkline-build-run-summaries.md src/features/build/build-run-summary.ts tests/frontend/build-domain.test.ts
git commit -m "feat: add build run summary selectors"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M13 by deriving stable build run summaries from existing domain data.
- Placeholder scan: No placeholders remain.
- Type consistency: Summaries consume `BuildState`, `BuildResult`, events, queue, and current run without duplicating store state.
