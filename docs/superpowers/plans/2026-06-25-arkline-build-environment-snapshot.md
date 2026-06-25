# ArkLine Build Environment Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach a reproducible environment snapshot to each completed build result.

**Architecture:** Add a small build-domain snapshot module that derives stable build context from `BuildPlan` and applied SDK settings. Pass the applied settings from `AppShell` into the build controller so `BuildResult.environment` records command, cwd, target/module/product/buildMode, and configured SDK/Node paths without changing current Build UI behavior.

**Tech Stack:** TypeScript, React, Vitest, existing settings store and build controller.

---

### Task 1: Add Environment Snapshot Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Import snapshot helper**

Add:

```ts
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
```

- [ ] **Step 2: Add snapshot test**

Add this block after the `build run model` tests:

```ts
describe("build environment snapshot", () => {
  it("captures build intent command and configured toolchain paths", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "china",
      buildMode: "release",
      clean: true,
      fastMode: false,
    });

    const snapshot = createBuildEnvironmentSnapshot({
      plan,
      settings: {
        harmonySdkPath: "/opt/harmony-sdk",
        semanticWorkerPath: "/opt/arkts-worker/index.js",
        nodePath: "/opt/node",
        autoDetect: false,
      },
    });

    expect(snapshot).toEqual({
      projectRoot: "/workspace/Demo",
      cwd: "/workspace/Demo",
      command: "./hvigorw clean --no-daemon && ./hvigorw assembleHap --mode module -p module=entry@china -p product=china -p buildMode=release --no-daemon",
      target: "hap",
      scope: "module",
      moduleName: "entry",
      product: "china",
      buildMode: "release",
      clean: true,
      fastMode: false,
      toolchain: {
        harmonySdkPath: "/opt/harmony-sdk",
        semanticWorkerPath: "/opt/arkts-worker/index.js",
        nodePath: "/opt/node",
        autoDetect: false,
      },
    });
  });
});
```

- [ ] **Step 3: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because `build-environment-snapshot` does not exist yet.

---

### Task 2: Implement Snapshot Model

**Files:**
- Modify: `src/features/build/build-model.ts`
- Create: `src/features/build/build-environment-snapshot.ts`

- [ ] **Step 1: Add snapshot types to build model**

Add to `src/features/build/build-model.ts`:

```ts
export type BuildToolchainSnapshot = {
  harmonySdkPath: string;
  semanticWorkerPath: string;
  nodePath: string;
  autoDetect: boolean;
};

export type BuildEnvironmentSnapshot = {
  projectRoot: string;
  cwd: string;
  command: string;
  target: BuildTarget;
  scope: BuildScope;
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  clean: boolean;
  fastMode: boolean;
  toolchain: BuildToolchainSnapshot;
};
```

Add to `BuildResult`:

```ts
environment?: BuildEnvironmentSnapshot;
```

- [ ] **Step 2: Add snapshot helper**

Create `src/features/build/build-environment-snapshot.ts`:

```ts
import type { BuildEnvironmentSnapshot, BuildPlan, BuildToolchainSnapshot } from "@/features/build/build-model";
import type { AppSettings } from "@/features/settings/settings-store";

export type BuildEnvironmentSnapshotInput = {
  plan: BuildPlan;
  settings?: AppSettings["sdk"] | null;
};

const emptyToolchainSnapshot: BuildToolchainSnapshot = {
  harmonySdkPath: "",
  semanticWorkerPath: "",
  nodePath: "",
  autoDetect: true,
};

export function createBuildEnvironmentSnapshot(input: BuildEnvironmentSnapshotInput): BuildEnvironmentSnapshot {
  const toolchain = input.settings
    ? {
      harmonySdkPath: input.settings.harmonySdkPath.trim(),
      semanticWorkerPath: input.settings.semanticWorkerPath.trim(),
      nodePath: input.settings.nodePath.trim(),
      autoDetect: input.settings.autoDetect,
    }
    : emptyToolchainSnapshot;

  return {
    projectRoot: input.plan.intent.projectRoot,
    cwd: input.plan.cwd,
    command: input.plan.command,
    target: input.plan.intent.target,
    scope: input.plan.intent.scope,
    moduleName: input.plan.intent.moduleName,
    product: input.plan.intent.product,
    buildMode: input.plan.intent.buildMode,
    clean: input.plan.intent.clean,
    fastMode: input.plan.intent.fastMode,
    toolchain,
  };
}
```

- [ ] **Step 3: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: PASS for snapshot tests.

---

### Task 3: Attach Snapshot in Controller and AppShell

**Files:**
- Modify: `src/features/build/build-run-model.ts`
- Modify: `src/features/build/build-controller.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Allow result helper to accept environment**

In `src/features/build/build-run-model.ts`, import `BuildEnvironmentSnapshot` and add optional `environment` to the input and returned `BuildResult`:

```ts
import type { BuildEnvironmentSnapshot, BuildIntent, BuildResult, BuildTarget, HarmonyBuildRequest } from "@/features/build/build-model";
```

Input field:

```ts
environment?: BuildEnvironmentSnapshot;
```

Returned field:

```ts
environment: input.environment,
```

- [ ] **Step 2: Update controller to create environment snapshots**

In `src/features/build/build-controller.ts`, import:

```ts
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import type { AppSettings } from "@/features/settings/settings-store";
```

Add to `executeHarmonyBuildPlan` input:

```ts
settings?: AppSettings["sdk"] | null;
```

Pass to `createBuildResultFromTerminalRun`:

```ts
environment: createBuildEnvironmentSnapshot({
  plan: input.plan,
  settings: input.settings,
}),
```

- [ ] **Step 3: Pass applied SDK settings from AppShell**

In `src/components/layout/AppShell.tsx`, update the `executeHarmonyBuildPlan` call:

```ts
settings: settingsRef.current.state.settings.sdk,
```

- [ ] **Step 4: Extend controller test**

In the controller execution test, pass settings:

```ts
settings: {
  harmonySdkPath: "/opt/harmony-sdk",
  semanticWorkerPath: "",
  nodePath: "/opt/node",
  autoDetect: false,
},
```

Add assertion:

```ts
expect(result.environment?.toolchain.nodePath).toBe("/opt/node");
expect(result.environment?.moduleName).toBe("entry");
```

- [ ] **Step 5: Run focused tests**

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
git add docs/superpowers/plans/2026-06-25-arkline-build-environment-snapshot.md src/features/build/build-model.ts src/features/build/build-environment-snapshot.ts src/features/build/build-run-model.ts src/features/build/build-controller.ts src/components/layout/AppShell.tsx tests/frontend/build-domain.test.ts
git commit -m "feat: capture build environment snapshot"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M7 by recording build environment facts in `BuildResult`.
- Placeholder scan: No placeholders remain.
- Type consistency: Snapshot types are in `build-model`, helper is pure, controller attaches the snapshot, and AppShell passes applied SDK settings.
