# ArkLine Build Artifacts History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record build artifact candidates and recent build history in the build domain.

**Architecture:** Add a pure artifact extractor that reads terminal output for `.hap`, `.app`, `.har`, and `.hsp` paths. Attach extracted artifacts to `BuildResult`, and let `BuildStore` keep a capped recent history of completed build results without changing the current Build UI.

**Tech Stack:** TypeScript, Vitest, existing build controller and store.

---

### Task 1: Add Artifact and History Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Import artifact helper**

Add:

```ts
import { extractBuildArtifacts } from "@/features/build/build-artifacts";
```

- [ ] **Step 2: Add artifact extractor tests**

Add this block after the environment snapshot tests:

```ts
describe("build artifacts", () => {
  it("extracts Harmony artifact paths from build output", () => {
    const artifacts = extractBuildArtifacts([
      "Generated artifact: /workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
      "Archive: /workspace/Demo/library/build/default/outputs/default/library.har",
    ].join("\n"));

    expect(artifacts).toEqual([
      {
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      },
      {
        path: "/workspace/Demo/library/build/default/outputs/default/library.har",
        kind: "har",
        source: "output",
      },
    ]);
  });

  it("deduplicates repeated artifact paths", () => {
    const artifacts = extractBuildArtifacts("out=/workspace/Demo/build/default/app/default/app.app\nagain /workspace/Demo/build/default/app/default/app.app");

    expect(artifacts).toEqual([
      {
        path: "/workspace/Demo/build/default/app/default/app.app",
        kind: "app",
        source: "output",
      },
    ]);
  });
});
```

- [ ] **Step 3: Extend controller and store tests**

In the controller execution test, include a `.hap` path in stdout:

```ts
stdout: "Generated artifact: /workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
```

Add:

```ts
expect(result.artifacts).toEqual([
  {
    path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
    kind: "hap",
    source: "output",
  },
]);
```

In the build store lifecycle test, after `store.finish(...)`, add:

```ts
expect(store.state.history).toHaveLength(1);
expect(store.state.history[0]?.runId).toBe("build-1");
```

- [ ] **Step 4: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because `build-artifacts` and `BuildState.history` do not exist yet.

---

### Task 2: Implement Artifact Model and Extractor

**Files:**
- Modify: `src/features/build/build-model.ts`
- Create: `src/features/build/build-artifacts.ts`

- [ ] **Step 1: Add artifact types**

Add to `src/features/build/build-model.ts`:

```ts
export type BuildArtifactKind = BuildTarget;

export type BuildArtifact = {
  path: string;
  kind: BuildArtifactKind;
  source: "output";
};
```

Add to `BuildResult`:

```ts
artifacts: BuildArtifact[];
```

Add to `BuildState`:

```ts
history: BuildResult[];
```

- [ ] **Step 2: Create artifact extractor**

Create `src/features/build/build-artifacts.ts`:

```ts
import type { BuildArtifact, BuildArtifactKind } from "@/features/build/build-model";

const artifactPattern = /((?:[A-Za-z]:)?[\\/][^\s"'<>]+?\.(hap|app|har|hsp))\b/gi;

export function extractBuildArtifacts(output: string): BuildArtifact[] {
  const artifacts = new Map<string, BuildArtifact>();
  let match: RegExpExecArray | null;

  while ((match = artifactPattern.exec(output)) !== null) {
    const path = match[1];
    const kind = match[2].toLowerCase() as BuildArtifactKind;

    artifacts.set(path, {
      path,
      kind,
      source: "output",
    });
  }

  return Array.from(artifacts.values());
}
```

- [ ] **Step 3: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: Still fail until controller/store attach artifacts and history.

---

### Task 3: Attach Artifacts to Results and Store History

**Files:**
- Modify: `src/features/build/build-run-model.ts`
- Modify: `src/features/build/build-controller.ts`
- Modify: `src/features/build/build-store.ts`

- [ ] **Step 1: Add artifacts to result helper**

In `src/features/build/build-run-model.ts`, import `BuildArtifact`, add optional input:

```ts
artifacts?: BuildArtifact[];
```

Return:

```ts
artifacts: input.artifacts ?? [],
```

- [ ] **Step 2: Extract artifacts in controller**

In `src/features/build/build-controller.ts`, import:

```ts
import { extractBuildArtifacts } from "@/features/build/build-artifacts";
```

After output is built, add:

```ts
const artifacts = extractBuildArtifacts(output);
```

Pass to result helper:

```ts
artifacts,
```

- [ ] **Step 3: Store recent history**

In `src/features/build/build-store.ts`, initialize:

```ts
history: [],
```

In `finish(result)`, after `state.lastResult = result`, add:

```ts
state.history = [result, ...state.history.filter((item) => item.runId !== result.runId)].slice(0, 20);
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
git add docs/superpowers/plans/2026-06-25-arkline-build-artifacts-history.md src/features/build/build-model.ts src/features/build/build-artifacts.ts src/features/build/build-run-model.ts src/features/build/build-controller.ts src/features/build/build-store.ts tests/frontend/build-domain.test.ts
git commit -m "feat: record build artifacts and history"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M9 data foundation by recording artifact candidates and recent build history.
- Placeholder scan: No placeholders remain.
- Type consistency: `BuildArtifact` is attached to `BuildResult`; `BuildState.history` stores completed `BuildResult` values.
