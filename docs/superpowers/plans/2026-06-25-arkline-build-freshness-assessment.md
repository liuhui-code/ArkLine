# ArkLine Build Freshness Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conservative build freshness assessment that can explain whether the current build plan matches a previous successful run without skipping execution.

**Architecture:** Add a pure `build-freshness` module that compares a `BuildPlan` plus expected environment snapshot against recent `BuildResult` history. Store the latest assessment in `BuildState` when a build starts, but do not change build execution or UI behavior.

**Tech Stack:** TypeScript, Vitest, existing build plan/result/history model.

---

### Task 1: Add Freshness Assessment Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Import freshness helper**

Add:

```ts
import { assessBuildFreshness } from "@/features/build/build-freshness";
```

- [ ] **Step 2: Add freshness tests**

Add this block after artifact tests:

```ts
describe("build freshness", () => {
  it("marks a matching successful build with artifacts as a current candidate", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const environment = createBuildEnvironmentSnapshot({ plan });
    const previous = createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 100,
      stdout: "",
      stderr: "",
      problems: [],
      artifacts: [{
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      }],
      environment,
    });

    expect(assessBuildFreshness({ plan, environment, history: [previous] })).toEqual({
      status: "candidate-current",
      reason: "matching-success",
      matchingRunId: "build-1",
      artifactPaths: ["/workspace/Demo/entry/build/default/outputs/default/entry-default.hap"],
    });
  });

  it("does not mark a matching build current when artifacts are missing", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const environment = createBuildEnvironmentSnapshot({ plan });
    const previous = createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 100,
      stdout: "",
      stderr: "",
      problems: [],
      environment,
    });

    expect(assessBuildFreshness({ plan, environment, history: [previous] })).toEqual({
      status: "unknown",
      reason: "artifacts-missing",
      matchingRunId: "build-1",
      artifactPaths: [],
    });
  });

  it("reports stale when successful history does not match the current command", () => {
    const oldPlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const nextPlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: null,
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const previous = createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 100,
      stdout: "",
      stderr: "",
      problems: [],
      artifacts: [{
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      }],
      environment: createBuildEnvironmentSnapshot({ plan: oldPlan }),
    });

    expect(assessBuildFreshness({
      plan: nextPlan,
      environment: createBuildEnvironmentSnapshot({ plan: nextPlan }),
      history: [previous],
    })).toEqual({
      status: "stale",
      reason: "command-changed",
      artifactPaths: [],
    });
  });
});
```

- [ ] **Step 3: Extend store test**

In the build store lifecycle test, after `store.finish(...)`, start the same plan again and assert:

```ts
store.start({
  ...planHarmonyBuildCommand({
    rootPath: "/workspace/Demo",
    target: "hap",
    moduleName: "entry",
    product: "default",
    buildMode: "debug",
    clean: false,
    fastMode: false,
  }),
  runId: "build-2",
});
expect(store.state.freshness.status).toBe("candidate-current");
```

- [ ] **Step 4: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because `build-freshness` and `BuildState.freshness` do not exist yet.

---

### Task 2: Implement Freshness Model

**Files:**
- Modify: `src/features/build/build-model.ts`
- Create: `src/features/build/build-freshness.ts`

- [ ] **Step 1: Add freshness types**

Add to `src/features/build/build-model.ts`:

```ts
export type BuildFreshnessStatus = "unknown" | "candidate-current" | "stale";
export type BuildFreshnessReason =
  | "no-history"
  | "no-successful-build"
  | "command-changed"
  | "environment-changed"
  | "artifacts-missing"
  | "matching-success";

export type BuildFreshnessAssessment = {
  status: BuildFreshnessStatus;
  reason: BuildFreshnessReason;
  matchingRunId?: string;
  artifactPaths: string[];
};
```

Add to `BuildState`:

```ts
freshness: BuildFreshnessAssessment;
```

- [ ] **Step 2: Create freshness helper**

Create `src/features/build/build-freshness.ts`:

```ts
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import type { BuildEnvironmentSnapshot, BuildFreshnessAssessment, BuildPlan, BuildResult } from "@/features/build/build-model";

export const unknownBuildFreshness: BuildFreshnessAssessment = {
  status: "unknown",
  reason: "no-history",
  artifactPaths: [],
};

function sameToolchain(left: BuildEnvironmentSnapshot["toolchain"], right: BuildEnvironmentSnapshot["toolchain"]) {
  return left.harmonySdkPath === right.harmonySdkPath
    && left.semanticWorkerPath === right.semanticWorkerPath
    && left.nodePath === right.nodePath
    && left.autoDetect === right.autoDetect;
}

function sameEnvironment(left: BuildEnvironmentSnapshot, right: BuildEnvironmentSnapshot) {
  return left.projectRoot === right.projectRoot
    && left.cwd === right.cwd
    && left.command === right.command
    && left.target === right.target
    && left.scope === right.scope
    && left.moduleName === right.moduleName
    && left.product === right.product
    && left.buildMode === right.buildMode
    && left.clean === right.clean
    && left.fastMode === right.fastMode
    && sameToolchain(left.toolchain, right.toolchain);
}

export function assessBuildFreshness(input: {
  plan: BuildPlan;
  history: BuildResult[];
  environment?: BuildEnvironmentSnapshot;
}): BuildFreshnessAssessment {
  const successful = input.history.filter((result) => result.status === "success");
  if (input.history.length === 0) {
    return unknownBuildFreshness;
  }
  if (successful.length === 0) {
    return {
      status: "unknown",
      reason: "no-successful-build",
      artifactPaths: [],
    };
  }

  const expectedEnvironment = input.environment ?? createBuildEnvironmentSnapshot({ plan: input.plan });
  const matching = successful.find((result) => result.environment && sameEnvironment(result.environment, expectedEnvironment));
  if (!matching) {
    const sameCommand = successful.some((result) => result.environment?.command === expectedEnvironment.command);
    return {
      status: "stale",
      reason: sameCommand ? "environment-changed" : "command-changed",
      artifactPaths: [],
    };
  }

  const artifactPaths = matching.artifacts.map((artifact) => artifact.path);
  if (artifactPaths.length === 0) {
    return {
      status: "unknown",
      reason: "artifacts-missing",
      matchingRunId: matching.runId,
      artifactPaths: [],
    };
  }

  return {
    status: "candidate-current",
    reason: "matching-success",
    matchingRunId: matching.runId,
    artifactPaths,
  };
}
```

- [ ] **Step 3: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: Still fail until store initializes and updates `freshness`.

---

### Task 3: Wire Store Freshness

**Files:**
- Modify: `src/features/build/build-store.ts`

- [ ] **Step 1: Import freshness helper**

Add:

```ts
import { assessBuildFreshness, unknownBuildFreshness } from "@/features/build/build-freshness";
```

- [ ] **Step 2: Initialize state**

Add to initial state:

```ts
freshness: unknownBuildFreshness,
```

- [ ] **Step 3: Assess on start**

Inside `start(plan)` after `state.currentRun = plan`, add:

```ts
state.freshness = assessBuildFreshness({
  plan,
  history: state.history,
});
```

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- tests/frontend/build-domain.test.ts tests/frontend/build-tool-window.test.tsx`

Expected: PASS.

---

### Task 4: Full Verification and Commit

**Files:**
- Modified files from Tasks 1-3

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-arkline-build-freshness-assessment.md src/features/build/build-model.ts src/features/build/build-freshness.ts src/features/build/build-store.ts tests/frontend/build-domain.test.ts
git commit -m "feat: add conservative build freshness assessment"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M10 as a conservative data-only freshness assessment.
- Placeholder scan: No placeholders remain.
- Type consistency: `BuildFreshnessAssessment` is owned by build model, produced by `build-freshness`, and stored on `BuildState`.
