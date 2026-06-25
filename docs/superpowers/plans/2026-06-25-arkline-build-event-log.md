# ArkLine Build Event Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured build event log foundation for future streaming build output, queued execution, and build observability.

**Architecture:** Extend the build model with `BuildEvent` records and store-level event APIs. The store records queued, started, diagnostics, artifacts, finished, and failed events with deterministic sequence numbers. Current UI behavior remains unchanged.

**Tech Stack:** TypeScript, Vitest, existing build store and build result model.

---

### Task 1: Add Build Event Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Add event lifecycle test**

Add this test inside `describe("build store", ...)`:

```ts
it("records build lifecycle events in sequence", () => {
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

  store.start({ ...plan, runId: "build-1" });
  store.finish(createBuildResultFromTerminalRun({
    runId: "build-1",
    exitCode: 0,
    durationMs: 1200,
    stdout: "BUILD SUCCESSFUL",
    stderr: "",
    problems: [{
      source: "build",
      severity: "warning",
      path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
      line: 1,
      column: 1,
      message: "Warning",
    }],
    artifacts: [{
      path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
      kind: "hap",
      source: "output",
    }],
    environment: createBuildEnvironmentSnapshot({ plan }),
  }));

  expect(store.eventsForRun("build-1").map((event) => event.kind)).toEqual([
    "started",
    "diagnostics",
    "artifacts",
    "finished",
  ]);
  expect(store.eventsForRun("build-1").map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
});
```

- [ ] **Step 2: Add queue and clear event test**

Add:

```ts
it("records queued events and can clear event logs", () => {
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

  store.enqueue({ runId: "build-1", plan, requestedAt: 100 });

  expect(store.state.events).toEqual([
    {
      sequence: 1,
      runId: "build-1",
      kind: "queued",
      message: "Queued Build HAP entry debug",
    },
  ]);

  store.clearEvents("build-1");
  expect(store.state.events).toEqual([]);
});
```

- [ ] **Step 3: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because build events are not implemented yet.

---

### Task 2: Implement Event Model and Store APIs

**Files:**
- Modify: `src/features/build/build-model.ts`
- Modify: `src/features/build/build-store.ts`

- [ ] **Step 1: Add event model**

Add to `src/features/build/build-model.ts`:

```ts
export type BuildEventKind = "queued" | "started" | "diagnostics" | "artifacts" | "finished" | "failed";

export type BuildEvent = {
  sequence: number;
  runId: string;
  kind: BuildEventKind;
  message: string;
  diagnosticCount?: number;
  artifactPaths?: string[];
  status?: BuildResultStatus;
};
```

Add to `BuildState`:

```ts
events: BuildEvent[];
```

- [ ] **Step 2: Add store event helpers**

In `src/features/build/build-store.ts`, import `BuildEvent`.

Inside `createBuildStore`, add:

```ts
let nextEventSequence = 0;
```

Initialize state:

```ts
events: [],
```

Add a local helper:

```ts
function appendEvent(event: Omit<BuildEvent, "sequence">) {
  const nextEvent = {
    ...event,
    sequence: ++nextEventSequence,
  };
  state.events = [...state.events, nextEvent].slice(-200);
  return nextEvent;
}
```

Expose methods:

```ts
appendEvent,
eventsForRun(runId: string) {
  return state.events.filter((event) => event.runId === runId);
},
clearEvents(runId?: string) {
  state.events = runId ? state.events.filter((event) => event.runId !== runId) : [];
},
```

- [ ] **Step 3: Record queue/start/finish/fail events**

In `enqueue(item)`, append:

```ts
appendEvent({
  runId: item.runId,
  kind: "queued",
  message: `Queued ${item.plan.label}`,
});
```

In `start(plan)`, append:

```ts
appendEvent({
  runId: plan.runId,
  kind: "started",
  message: plan.label,
});
```

In `finish(result)`, append diagnostics/artifacts conditionally and finished always:

```ts
if (result.diagnostics.length > 0) {
  appendEvent({
    runId: result.runId,
    kind: "diagnostics",
    message: `${result.diagnostics.length} build diagnostic${result.diagnostics.length === 1 ? "" : "s"}`,
    diagnosticCount: result.diagnostics.length,
  });
}
if (result.artifacts.length > 0) {
  appendEvent({
    runId: result.runId,
    kind: "artifacts",
    message: `${result.artifacts.length} build artifact${result.artifacts.length === 1 ? "" : "s"}`,
    artifactPaths: result.artifacts.map((artifact) => artifact.path),
  });
}
appendEvent({
  runId: result.runId,
  kind: "finished",
  message: state.message,
  status: result.status,
});
```

In `fail(message)`, append if there is a current run:

```ts
if (state.currentRun?.runId) {
  appendEvent({
    runId: state.currentRun.runId,
    kind: "failed",
    message,
    status: "failed",
  });
}
```

- [ ] **Step 4: Run focused tests**

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
git add docs/superpowers/plans/2026-06-25-arkline-build-event-log.md src/features/build/build-model.ts src/features/build/build-store.ts tests/frontend/build-domain.test.ts
git commit -m "feat: add build event log foundation"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M12 as a build event log foundation without changing UI behavior.
- Placeholder scan: No placeholders remain.
- Type consistency: `BuildEvent` is stored in `BuildState.events`; store methods expose append/filter/clear behavior.
