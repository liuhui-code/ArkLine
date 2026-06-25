# ArkLine Build Queue Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a build queue data foundation so future background build execution can sequence pending build plans safely.

**Architecture:** Extend the build model with `BuildQueueItem` and store-level queue operations. Keep current UI behavior unchanged: AppShell still ignores repeated build requests while a build is running, but the build domain can now enqueue, dequeue, and clear pending plans for future queue/daemon work.

**Tech Stack:** TypeScript, Vitest, existing build store and planner.

---

### Task 1: Add Build Queue Store Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Add queue test**

Add this test inside `describe("build store", ...)` after the lifecycle test:

```ts
it("queues pending build plans in FIFO order", () => {
  const store = createBuildStore();
  const firstPlan = planHarmonyBuildCommand({
    rootPath: "/workspace/Demo",
    target: "hap",
    moduleName: "entry",
    product: "default",
    buildMode: "debug",
    clean: false,
    fastMode: false,
  });
  const secondPlan = planHarmonyBuildCommand({
    rootPath: "/workspace/Demo",
    target: "app",
    moduleName: null,
    product: "default",
    buildMode: "release",
    clean: false,
    fastMode: false,
  });

  store.enqueue({ runId: "build-1", plan: firstPlan, requestedAt: 100 });
  store.enqueue({ runId: "build-2", plan: secondPlan, requestedAt: 200 });

  expect(store.state.queue.map((item) => item.runId)).toEqual(["build-1", "build-2"]);
  expect(store.dequeueNext()?.runId).toBe("build-1");
  expect(store.dequeueNext()?.runId).toBe("build-2");
  expect(store.dequeueNext()).toBeNull();
});
```

- [ ] **Step 2: Add dedupe and clear test**

Add:

```ts
it("replaces queued plans with the same run id and clears the queue", () => {
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
  store.enqueue({ runId: "build-1", plan: { ...plan, label: "Replacement" }, requestedAt: 200 });

  expect(store.state.queue).toHaveLength(1);
  expect(store.state.queue[0]?.plan.label).toBe("Replacement");

  store.clearQueue();
  expect(store.state.queue).toEqual([]);
});
```

- [ ] **Step 3: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because queue state and methods do not exist yet.

---

### Task 2: Implement Queue Model and Store Methods

**Files:**
- Modify: `src/features/build/build-model.ts`
- Modify: `src/features/build/build-store.ts`

- [ ] **Step 1: Add queue model**

Add to `src/features/build/build-model.ts`:

```ts
export type BuildQueueItem = {
  runId: string;
  plan: BuildPlan;
  requestedAt: number;
};
```

Add to `BuildState`:

```ts
queue: BuildQueueItem[];
```

- [ ] **Step 2: Add queue state and methods**

In `src/features/build/build-store.ts`, initialize:

```ts
queue: [],
```

Import `BuildQueueItem`:

```ts
import type { BuildQueueItem, BuildResult, BuildState, HarmonyBuildPlan } from "@/features/build/build-model";
```

Add methods to the returned object:

```ts
enqueue(item: BuildQueueItem) {
  state.queue = [...state.queue.filter((queued) => queued.runId !== item.runId), item];
},
dequeueNext() {
  const [next, ...remaining] = state.queue;
  state.queue = remaining;
  return next ?? null;
},
clearQueue() {
  state.queue = [];
},
```

- [ ] **Step 3: Run focused tests**

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
git add docs/superpowers/plans/2026-06-25-arkline-build-queue-foundation.md src/features/build/build-model.ts src/features/build/build-store.ts tests/frontend/build-domain.test.ts
git commit -m "feat: add build queue foundation"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M11 as a data-layer build queue foundation without changing UI behavior.
- Placeholder scan: No placeholders remain.
- Type consistency: `BuildQueueItem` uses `BuildPlan`; store queue methods mutate `BuildState.queue`.
