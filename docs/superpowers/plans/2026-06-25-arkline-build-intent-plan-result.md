# ArkLine Build Intent Plan Result Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Harmony build feature into stable `BuildIntent`, `BuildPlan`, and `BuildResult` domain boundaries without changing the current user-facing Build panel behavior.

**Architecture:** Keep the existing terminal-backed build execution, but stop treating command parameters as the core domain model. Add small conversion helpers so UI state becomes a `BuildIntent`, the planner returns a richer `BuildPlan`, and completed terminal output becomes a structured `BuildResult` before updating stores and Problems.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, existing Tauri workspace API bridge.

---

### Task 1: Add Build Intent and Result Domain Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Add imports for new helpers**

Add these imports near the top of `tests/frontend/build-domain.test.ts`:

```ts
import { createBuildIntent, createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
```

- [ ] **Step 2: Add tests for intent normalization and result shaping**

Add this `describe` block before the existing `describe("Harmony build command planner", ...)` block:

```ts
describe("build run model", () => {
  it("normalizes UI build choices into a durable build intent", () => {
    const intent = createBuildIntent({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "  entry  ",
      product: "  default  ",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    expect(intent).toEqual({
      kind: "build",
      projectRoot: "/workspace/Demo",
      target: "hap",
      scope: "module",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
  });

  it("uses project scope and no module for APP intents", () => {
    const intent = createBuildIntent({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: "entry",
      product: "",
      buildMode: "release",
      clean: true,
      fastMode: true,
    });

    expect(intent.scope).toBe("project");
    expect(intent.moduleName).toBeNull();
    expect(intent.product).toBe("default");
  });

  it("converts a terminal run into a structured build result", () => {
    const result = createBuildResultFromTerminalRun({
      runId: "build-1",
      planId: "plan-1",
      exitCode: 1,
      durationMs: 90,
      stdout: "",
      stderr: "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.",
      problems: [
        {
          source: "build",
          severity: "error",
          path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
          line: 12,
          column: 8,
          message: "Property width does not exist.",
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Property width does not exist.");
    expect(result.diagnostics).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because `build-run-model` does not exist yet.

---

### Task 2: Implement Build Run Model

**Files:**
- Create: `src/features/build/build-run-model.ts`
- Modify: `src/features/build/build-model.ts`

- [ ] **Step 1: Add durable domain types**

Modify `src/features/build/build-model.ts` so it includes these exported types while keeping the existing `BuildTarget`, `BuildStatus`, `HarmonyBuildRequest`, and `HarmonyBuildPlan` exports available:

```ts
export type BuildActionKind = "build";
export type BuildScope = "project" | "module";

export type BuildIntent = {
  kind: BuildActionKind;
  projectRoot: string;
  target: BuildTarget;
  scope: BuildScope;
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  clean: boolean;
  fastMode: boolean;
};

export type BuildPlanStep = {
  label: string;
  command: string;
};

export type BuildPlan = {
  id?: string;
  label: string;
  cwd: string;
  target: BuildTarget;
  intent: BuildIntent;
  steps: BuildPlanStep[];
  command: string;
};

export type BuildResultStatus = "success" | "failed" | "stopped";

export type BuildResult = {
  runId: string;
  planId?: string;
  status: BuildResultStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
  stdout: string;
  stderr: string;
  diagnostics: ProblemItem[];
};
```

Update compatibility aliases:

```ts
export type HarmonyBuildRequest = {
  rootPath: string;
  target: BuildTarget;
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  clean: boolean;
  fastMode: boolean;
};

export type HarmonyBuildPlan = BuildPlan;
```

- [ ] **Step 2: Create normalization helpers**

Create `src/features/build/build-run-model.ts`:

```ts
import type { ProblemItem } from "@/features/problems/problems-store";
import type { BuildIntent, BuildResult, BuildTarget, HarmonyBuildRequest } from "@/features/build/build-model";

export function createBuildIntent(request: HarmonyBuildRequest): BuildIntent {
  const product = request.product.trim() || "default";
  const scope = request.target === "app" ? "project" : "module";
  const moduleName = scope === "module"
    ? request.moduleName?.trim() || "entry"
    : null;

  return {
    kind: "build",
    projectRoot: request.rootPath,
    target: request.target,
    scope,
    moduleName,
    product,
    buildMode: request.buildMode,
    clean: request.clean,
    fastMode: request.fastMode,
  };
}

export function createBuildResultFromTerminalRun(input: {
  runId: string;
  planId?: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  problems: ProblemItem[];
  stopped?: boolean;
}): BuildResult {
  const status = input.stopped ? "stopped" : input.exitCode === 0 ? "success" : "failed";
  const output = [input.stdout, input.stderr].filter(Boolean).join("\n");

  return {
    runId: input.runId,
    planId: input.planId,
    status,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    output,
    stdout: input.stdout,
    stderr: input.stderr,
    diagnostics: input.problems,
  };
}

export function targetRequiresModule(target: BuildTarget) {
  return target !== "app";
}
```

- [ ] **Step 3: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: Tests still fail until the planner is updated to return the new `BuildPlan` shape.

---

### Task 3: Move Command Planner onto BuildIntent

**Files:**
- Modify: `src/features/build/build-command-planner.ts`
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Update planner to use normalized intent and plan steps**

Modify `src/features/build/build-command-planner.ts` so `planHarmonyBuildCommand(request)` first calls `createBuildIntent(request)` and returns a `BuildPlan` with `intent` and `steps`:

```ts
import type { BuildIntent, BuildPlan, BuildTarget, HarmonyBuildRequest } from "@/features/build/build-model";
import { createBuildIntent } from "@/features/build/build-run-model";

function quoteValue(value: string) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function taskForTarget(target: BuildTarget) {
  switch (target) {
    case "app":
      return "assembleApp";
    case "har":
      return "assembleHar";
    case "hsp":
      return "assembleHsp";
    case "hap":
    default:
      return "assembleHap";
  }
}

function labelForTarget(target: BuildTarget) {
  return target.toUpperCase();
}

function commandForIntent(intent: BuildIntent) {
  const daemonArg = intent.fastMode ? "" : " --no-daemon";
  const task = taskForTarget(intent.target);
  const moduleArg = intent.scope === "module" && intent.moduleName
    ? ` -p module=${quoteValue(`${intent.moduleName}@${intent.product}`)}`
    : "";

  return [
    "./hvigorw",
    task,
    `--mode ${intent.scope}`,
    moduleArg.trim(),
    `-p product=${quoteValue(intent.product)}`,
    `-p buildMode=${quoteValue(intent.buildMode)}`,
  ].filter(Boolean).join(" ") + daemonArg;
}

export function planHarmonyBuildCommand(request: HarmonyBuildRequest): BuildPlan {
  const intent = createBuildIntent(request);
  const daemonArg = intent.fastMode ? "" : " --no-daemon";
  const buildCommand = commandForIntent(intent);
  const steps = intent.clean
    ? [
      { label: "Clean", command: `./hvigorw clean${daemonArg}` },
      { label: "Build", command: buildCommand },
    ]
    : [{ label: "Build", command: buildCommand }];

  return {
    label: `Build ${labelForTarget(intent.target)} ${intent.moduleName ?? "project"} ${intent.buildMode}`,
    command: steps.map((step) => step.command).join(" && "),
    cwd: intent.projectRoot,
    target: intent.target,
    intent,
    steps,
  };
}
```

- [ ] **Step 2: Extend planner test expectations**

In the first planner test, add:

```ts
expect(plan.intent.scope).toBe("module");
expect(plan.intent.moduleName).toBe("entry");
expect(plan.steps).toEqual([
  {
    label: "Build",
    command: "./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon",
  },
]);
```

In the clean test, add:

```ts
expect(plan.steps.map((step) => step.label)).toEqual(["Clean", "Build"]);
```

- [ ] **Step 3: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: PASS.

---

### Task 4: Update Build Store to Persist BuildResult

**Files:**
- Modify: `src/features/build/build-model.ts`
- Modify: `src/features/build/build-store.ts`
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Add `lastResult` to build state**

Add to `BuildState` in `src/features/build/build-model.ts`:

```ts
lastResult: BuildResult | null;
```

- [ ] **Step 2: Update store finish flow**

Modify `src/features/build/build-store.ts` so it imports `BuildResult`, initializes `lastResult: null`, and `finish(result: BuildResult)` updates from the structured result:

```ts
import type { BuildResult, BuildState, HarmonyBuildPlan } from "@/features/build/build-model";
```

Inside initial state:

```ts
lastResult: null,
```

Inside `start(...)`:

```ts
state.lastResult = null;
```

Replace `finish(result: BuildRunFinish)` with:

```ts
finish(result: BuildResult) {
  state.status = result.status;
  state.output = result.output;
  state.problems = result.diagnostics;
  state.lastResult = result;
  state.lastExitCode = result.exitCode;
  state.lastDurationMs = result.durationMs;
  state.message = state.status === "success" ? "Build succeeded" : state.status === "stopped" ? "Build stopped" : "Build failed";
  state.currentRun = null;
},
```

- [ ] **Step 3: Update store lifecycle test**

In the build store test, call `store.finish(createBuildResultFromTerminalRun(...))` instead of passing raw terminal fields directly:

```ts
store.finish(createBuildResultFromTerminalRun({
  runId: "build-1",
  exitCode: 0,
  durationMs: 1200,
  stdout: "BUILD SUCCESSFUL",
  stderr: "",
  problems: [],
}));
```

Add:

```ts
expect(store.state.lastResult?.status).toBe("success");
```

- [ ] **Step 4: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: PASS.

---

### Task 5: Use BuildResult in AppShell Execution

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/build-tool-window.test.tsx`

- [ ] **Step 1: Import result helper**

Add to `src/components/layout/AppShell.tsx` imports:

```ts
import { createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
```

- [ ] **Step 2: Convert terminal output into BuildResult before store update**

In `runBuild(clean = false)`, replace:

```ts
buildStoreRef.current.finish({ ...result, problems: parsedProblems });
```

with:

```ts
const buildResult = createBuildResultFromTerminalRun({
  ...result,
  planId: plan.id,
  problems: parsedProblems,
});
buildStoreRef.current.finish(buildResult);
```

- [ ] **Step 3: Add integration assertion**

In `tests/frontend/build-tool-window.test.tsx`, in the first build test after the status assertion, add:

```ts
expect(screen.getByLabelText("Build Status")).toHaveTextContent("Build succeeded");
```

This assertion already matches visible behavior and protects the integration path after the store signature change.

- [ ] **Step 4: Run focused integration test**

Run: `pnpm test -- tests/frontend/build-tool-window.test.tsx`

Expected: PASS.

---

### Task 6: Full Verification and Commit

**Files:**
- Modified files from Tasks 1-5

- [ ] **Step 1: Run all frontend tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 3: Review git diff**

Run: `git status --short`

Expected: Only the build domain files, AppShell integration, tests, and this plan are changed.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-arkline-build-intent-plan-result.md src/features/build/build-model.ts src/features/build/build-run-model.ts src/features/build/build-command-planner.ts src/features/build/build-store.ts src/components/layout/AppShell.tsx tests/frontend/build-domain.test.ts tests/frontend/build-tool-window.test.tsx
git commit -m "refactor: split build intent plan result"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements the approved M5 architecture slice by adding `BuildIntent`, richer `BuildPlan`, and `BuildResult`, while leaving cache/history/controller extraction for later stages.
- Placeholder scan: No placeholder steps remain.
- Type consistency: `BuildIntent`, `BuildPlan`, `BuildResult`, `HarmonyBuildPlan`, and store `finish()` signatures are aligned across tasks.
