# ArkLine Build Diagnostic Matchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hard-coded build output parser with a small diagnostic matcher registry while preserving current Problems behavior.

**Architecture:** Add `src/features/build/build-diagnostics.ts` with `BuildDiagnosticMatcher`, default Hvigor file-location matcher, and `parseBuildDiagnostics()`. Keep `parseBuildProblems()` as a compatibility wrapper. Let `executeHarmonyBuildPlan()` accept optional matchers for future tool-specific parsing.

**Tech Stack:** TypeScript, Vitest, existing Problems model and build controller.

---

### Task 1: Add Matcher Registry Tests

**Files:**
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Import matcher APIs**

Add:

```ts
import { defaultBuildDiagnosticMatchers, parseBuildDiagnostics, type BuildDiagnosticMatcher } from "@/features/build/build-diagnostics";
```

- [ ] **Step 2: Add tests**

Add this block before `describe("build output parser", ...)`:

```ts
describe("build diagnostic matchers", () => {
  it("uses default matchers to parse Hvigor file diagnostics", () => {
    const output = "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.";

    expect(parseBuildDiagnostics(output, defaultBuildDiagnosticMatchers)).toEqual([
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

  it("allows custom build diagnostic matchers", () => {
    const customMatcher: BuildDiagnosticMatcher = {
      id: "custom-packager",
      match(output) {
        return output.includes("PACKAGER_FAIL")
          ? [{
            source: "build",
            severity: "error",
            path: "/workspace/Demo/build-profile.json5",
            line: 1,
            column: 1,
            message: "Packager failed",
          }]
          : [];
      },
    };

    expect(parseBuildDiagnostics("PACKAGER_FAIL", [customMatcher])).toEqual([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/build-profile.json5",
        line: 1,
        column: 1,
        message: "Packager failed",
      },
    ]);
  });
});
```

- [ ] **Step 3: Run focused test to verify failure**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: FAIL because `build-diagnostics` does not exist yet.

---

### Task 2: Implement Diagnostic Matchers

**Files:**
- Create: `src/features/build/build-diagnostics.ts`
- Modify: `src/features/build/build-output-parser.ts`

- [ ] **Step 1: Create matcher module**

Create `src/features/build/build-diagnostics.ts`:

```ts
import type { ProblemItem } from "@/features/problems/problems-store";

export type BuildDiagnosticMatcher = {
  id: string;
  match(output: string): ProblemItem[];
};

const fileLocationPattern = /(?:File:\s*)?((?:[A-Za-z]:)?[\\/].+?\.(?:ets|ts|js|json5|json|hml|css|less|scss)):(\d+):(\d+)(?:\s*(.*))?/i;

function severityFromLine(line: string): ProblemItem["severity"] {
  return /\b(warn|warning)\b/i.test(line) ? "warning" : "error";
}

function cleanMessage(raw: string) {
  return raw.replace(/^[-:\s]+/, "").trim();
}

export const hvigorFileDiagnosticMatcher: BuildDiagnosticMatcher = {
  id: "hvigor-file-location",
  match(output) {
    const lines = output.split(/\r?\n/);
    const problems: ProblemItem[] = [];

    lines.forEach((line, index) => {
      const match = line.match(fileLocationPattern);
      if (!match) {
        return;
      }

      const inlineMessage = cleanMessage(match[4] ?? "");
      const nextMessage = cleanMessage(lines[index + 1] ?? "");
      problems.push({
        source: "build",
        severity: severityFromLine(line),
        path: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        message: inlineMessage || nextMessage || "Build diagnostic",
      });
    });

    return problems;
  },
};

export const defaultBuildDiagnosticMatchers: BuildDiagnosticMatcher[] = [
  hvigorFileDiagnosticMatcher,
];

export function parseBuildDiagnostics(output: string, matchers = defaultBuildDiagnosticMatchers): ProblemItem[] {
  return matchers.flatMap((matcher) => matcher.match(output));
}
```

- [ ] **Step 2: Replace old parser implementation with wrapper**

Replace `src/features/build/build-output-parser.ts` with:

```ts
import type { ProblemItem } from "@/features/problems/problems-store";
import { parseBuildDiagnostics } from "@/features/build/build-diagnostics";

export function parseBuildProblems(output: string): ProblemItem[] {
  return parseBuildDiagnostics(output);
}
```

- [ ] **Step 3: Run focused test**

Run: `pnpm test -- tests/frontend/build-domain.test.ts`

Expected: PASS.

---

### Task 3: Let Controller Accept Matchers

**Files:**
- Modify: `src/features/build/build-controller.ts`
- Modify: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Update controller**

In `src/features/build/build-controller.ts`, replace `parseBuildProblems` import with:

```ts
import { parseBuildDiagnostics, type BuildDiagnosticMatcher } from "@/features/build/build-diagnostics";
```

Add optional input:

```ts
diagnosticMatchers?: BuildDiagnosticMatcher[];
```

Replace parser call:

```ts
const problems = parseBuildDiagnostics(output, input.diagnosticMatchers);
```

- [ ] **Step 2: Add controller custom matcher test**

In the controller execution test, pass:

```ts
diagnosticMatchers: [{
  id: "empty",
  match: () => [],
}],
```

Then change the diagnostics expectation to:

```ts
expect(result.diagnostics).toEqual([]);
```

Add a separate controller test for default matcher if needed by reusing existing output without `diagnosticMatchers`.

- [ ] **Step 3: Run focused tests**

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
git add docs/superpowers/plans/2026-06-25-arkline-build-diagnostic-matchers.md src/features/build/build-diagnostics.ts src/features/build/build-output-parser.ts src/features/build/build-controller.ts tests/frontend/build-domain.test.ts
git commit -m "refactor: add build diagnostic matchers"
```

Expected: Commit succeeds.

---

## Self-Review

- Spec coverage: Implements M8 by introducing a matcher registry while keeping current parser compatibility.
- Placeholder scan: No placeholders remain.
- Type consistency: `BuildDiagnosticMatcher` is used by parser tests and controller.
