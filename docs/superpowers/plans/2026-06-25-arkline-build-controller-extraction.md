# ArkLine Build Controller Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Harmony build planning and terminal execution control out of `AppShell` into a focused build controller module.

**Architecture:** Add `src/features/build/build-controller.ts` as the build-domain coordinator for deriving a plan from `BuildState` and executing a `BuildPlan` through the existing terminal API. `AppShell` keeps UI state transitions, but delegates plan creation, terminal invocation, output parsing, and `BuildResult` creation to the controller.

**Tech Stack:** TypeScript, React, Vitest, existing workspace terminal bridge.

---

### Task 1: Add Controller Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Import controller helpers**

Add this import:

```ts
import { createHarmonyBuildPlanFromState, executeHarmonyBuildPlan } from "@/features/build/build-controller";
```

- [ ] **Step 2: Add controller tests**

Add this block after the command planner tests:

```ts
describe("build controller", () => {
  it("creates a Harmony build plan from build state", () => {
    const store = createBuildStore();
    store.configure({
      lastTarget: "hap",
      moduleName: " entry ",
      product: " china ",
      buildMode: "release",
      fastMode: true,
    });

    const plan = createHarmonyBuildPlanFromState({
      rootPath: "/workspace/Demo",
      state: store.state,
      clean: false,
    });

    expect(plan.command).toBe("./hvigorw assembleHap --mode module -p module=entry@china -p product=china -p buildMode=release");
    expect(plan.intent.product).toBe("china");
  });

  it("executes a build plan through the terminal runner and returns parsed diagnostics", async () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    const result = await executeHarmonyBuildPlan({
      runId: "build-1",
      plan,
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "",
        stderr: "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.",
        exitCode: 1,
        durationMs: 90,
        stopped: false,
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics).toEqual([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        line: 12,
        column: 8,
        message: "Property width does not exist.",
      },
    ]);
  });
});
```

- [ ] **Step 3: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because `build-controller` does not exist yet.

---

### Task 2: Implement Build Controller

**Files:**
- Create: `src/features/build/build-controller.ts`

- [ ] **Step 1: Create controller module**

Create `src/features/build/build-controller.ts`:

```ts
import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import type { BuildPlan, BuildResult, BuildState } from "@/features/build/build-model";
import { parseBuildProblems } from "@/features/build/build-output-parser";
import { createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
import type { TerminalRunRequest, TerminalRunResult } from "@/features/workspace/workspace-api";

export type BuildPlanFromStateInput = {
  rootPath: string;
  state: Pick<BuildState, "lastTarget" | "moduleName" | "product" | "buildMode" | "fastMode">;
  clean: boolean;
};

export type TerminalBuildRunner = (request: TerminalRunRequest) => Promise<TerminalRunResult>;

export function createHarmonyBuildPlanFromState(input: BuildPlanFromStateInput): BuildPlan {
  const target = input.state.lastTarget;

  return planHarmonyBuildCommand({
    rootPath: input.rootPath,
    target,
    moduleName: target === "app" ? null : input.state.moduleName,
    product: input.state.product,
    buildMode: input.state.buildMode,
    clean: input.clean,
    fastMode: input.state.fastMode,
  });
}

export async function executeHarmonyBuildPlan(input: {
  runId: string;
  plan: BuildPlan;
  runTerminalCommand: TerminalBuildRunner;
}): Promise<BuildResult> {
  const terminalResult = await input.runTerminalCommand({
    runId: input.runId,
    command: input.plan.command,
    cwd: input.plan.cwd,
    source: "preset",
  });
  const output = [terminalResult.stdout, terminalResult.stderr].filter(Boolean).join("\n");
  const problems = parseBuildProblems(output);

  return createBuildResultFromTerminalRun({
    ...terminalResult,
    planId: input.plan.id,
    problems,
  });
}
```

- [ ] **Step 2: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: PASS.

---

### Task 3: Wire AppShell to Build Controller

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/build-tool-window.test.tsx`

- [ ] **Step 1: Replace build imports**

In `src/components/layout/AppShell.tsx`, remove:

```ts
import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { parseBuildProblems } from "@/features/build/build-output-parser";
import { createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
```

Add:

```ts
import { createHarmonyBuildPlanFromState, executeHarmonyBuildPlan } from "@/features/build/build-controller";
```

- [ ] **Step 2: Replace plan creation in `runBuild`**

Replace the `planHarmonyBuildCommand({ ... })` call with:

```ts
const plan = createHarmonyBuildPlanFromState({
  rootPath: workspace.rootPath,
  state,
  clean,
});
```

- [ ] **Step 3: Replace terminal execution and parsing block**

Replace:

```ts
const result = await workspaceApi.runTerminalCommand({
  runId,
  command: plan.command,
  cwd: plan.cwd,
  source: "preset",
});
const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
const parsedProblems = parseBuildProblems(output);
const buildResult = createBuildResultFromTerminalRun({
  ...result,
  planId: plan.id,
  problems: parsedProblems,
});
buildStoreRef.current.finish(buildResult);
problemsRef.current.replace([
  ...problemsRef.current.state.items.filter((item) => item.source !== "build"),
  ...parsedProblems,
]);
```

with:

```ts
const buildResult = await executeHarmonyBuildPlan({
  runId,
  plan,
  runTerminalCommand: workspaceApi.runTerminalCommand,
});
buildStoreRef.current.finish(buildResult);
problemsRef.current.replace([
  ...problemsRef.current.state.items.filter((item) => item.source !== "build"),
  ...buildResult.diagnostics,
]);
```

- [ ] **Step 4: Run focused integration test**

Run: `pnpm test -- tests/frontend/build-tool-window.test.tsx`

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
git add docs/superpowers/plans/2026-06-25-arkline-build-controller-extraction.md src/features/build/build-controller.ts src/components/layout/AppShell.tsx tests/frontend/build-domain.test.ts
git commit -m "refactor: extract harmony build controller"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M6 by moving plan derivation and terminal execution/parsing out of `AppShell`.
- Placeholder scan: No placeholders remain.
- Type consistency: Controller uses existing `BuildState`, `BuildPlan`, `BuildResult`, and workspace terminal API types.
