# ArkLine Harmony Build Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a maintainable HarmonyOS build surface that can run Hvigor/HvigorW builds, expose build status, parse build diagnostics into Problems, and leave clear extension points for faster incremental builds.

**Architecture:** Introduce a frontend build domain that plans Hvigor commands separately from terminal UI. The first implementation reuses `WorkspaceApi.runTerminalCommand` for execution, while keeping build planning, output parsing, state, and UI isolated so later Rust-side project detection, daemon/cache strategy, and CLI reuse do not require UI rewrites.

**Tech Stack:** React, TypeScript, Vitest, existing Tauri terminal command bridge, existing Problems store and bottom tool window.

---

### Task 1: Add Build Domain Model, Planner, Parser, And Store

**Files:**
- Create: `src/features/build/build-model.ts`
- Create: `src/features/build/build-command-planner.ts`
- Create: `src/features/build/build-output-parser.ts`
- Create: `src/features/build/build-store.ts`
- Modify: `src/features/problems/problems-store.ts`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/build-domain.test.ts`

- [ ] **Step 1: Write failing build domain tests**

Create `tests/frontend/build-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { parseBuildProblems } from "@/features/build/build-output-parser";
import { createBuildStore } from "@/features/build/build-store";
import { createProblemsStore } from "@/features/problems/problems-store";

describe("Harmony build command planner", () => {
  it("plans a module HAP build through the project wrapper without clean by default", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    expect(plan.cwd).toBe("/workspace/Demo");
    expect(plan.command).toBe('./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon');
    expect(plan.label).toBe("Build HAP entry debug");
  });

  it("plans a project APP build and keeps daemon available in fast mode", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: null,
      product: "default",
      buildMode: "release",
      clean: false,
      fastMode: true,
    });

    expect(plan.command).toBe("./hvigorw assembleApp --mode project -p product=default -p buildMode=release");
  });

  it("prefixes clean only when explicitly requested", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: true,
      fastMode: false,
    });

    expect(plan.command).toBe('./hvigorw clean --no-daemon && ./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon');
  });
});

describe("build output parser", () => {
  it("extracts Hvigor file diagnostics into build problems", () => {
    const output = [
      "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8",
      "Property width does not exist on type Foo.",
      "WARN: /workspace/Demo/entry/src/main/ets/pages/About.ets:4:2 deprecated API",
    ].join("\n");

    expect(parseBuildProblems(output)).toEqual([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        line: 12,
        column: 8,
        message: "Property width does not exist on type Foo.",
      },
      {
        source: "build",
        severity: "warning",
        path: "/workspace/Demo/entry/src/main/ets/pages/About.ets",
        line: 4,
        column: 2,
        message: "deprecated API",
      },
    ]);
  });

  it("allows build diagnostics in the shared problems store", () => {
    const store = createProblemsStore();
    store.replace([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        line: 12,
        column: 8,
        message: "Build failed",
      },
    ]);

    expect(store.state.items).toHaveLength(1);
  });
});

describe("build store", () => {
  it("tracks a run lifecycle and last duration", () => {
    const store = createBuildStore();

    store.start({
      runId: "build-1",
      label: "Build HAP entry debug",
      command: "./hvigorw assembleHap",
      cwd: "/workspace/Demo",
      target: "hap",
    });
    expect(store.state.status).toBe("running");

    store.finish({
      exitCode: 0,
      durationMs: 1200,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      problems: [],
    });

    expect(store.state.status).toBe("success");
    expect(store.state.lastDurationMs).toBe(1200);
    expect(store.state.output).toContain("BUILD SUCCESSFUL");
  });
});
```

- [ ] **Step 2: Run domain tests to verify they fail**

Run:

```bash
pnpm exec vitest run tests/frontend/build-domain.test.ts
```

Expected: FAIL because the build files and `"build"` problem source do not exist.

- [ ] **Step 3: Add build model types**

Create `src/features/build/build-model.ts`:

```ts
import type { ProblemItem } from "@/features/problems/problems-store";

export type BuildTarget = "hap" | "app" | "har" | "hsp";
export type BuildStatus = "idle" | "planning" | "running" | "success" | "failed" | "stopped";

export type HarmonyBuildRequest = {
  rootPath: string;
  target: BuildTarget;
  moduleName: string | null;
  product: string;
  buildMode: "debug" | "release";
  clean: boolean;
  fastMode: boolean;
};

export type HarmonyBuildPlan = {
  runId?: string;
  label: string;
  command: string;
  cwd: string;
  target: BuildTarget;
};

export type BuildRunFinish = {
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  problems: ProblemItem[];
  stopped?: boolean;
};

export type BuildState = {
  status: BuildStatus;
  currentRun: HarmonyBuildPlan | null;
  lastTarget: BuildTarget;
  moduleName: string;
  product: string;
  buildMode: "debug" | "release";
  fastMode: boolean;
  output: string;
  problems: ProblemItem[];
  lastExitCode: number | null;
  lastDurationMs: number | null;
  message: string;
};
```

- [ ] **Step 4: Add command planner**

Create `src/features/build/build-command-planner.ts`:

```ts
import type { BuildTarget, HarmonyBuildPlan, HarmonyBuildRequest } from "@/features/build/build-model";

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

function modeForTarget(target: BuildTarget) {
  return target === "app" ? "project" : "module";
}

function labelForTarget(target: BuildTarget) {
  return target.toUpperCase();
}

export function planHarmonyBuildCommand(request: HarmonyBuildRequest): HarmonyBuildPlan {
  const daemonArg = request.fastMode ? "" : " --no-daemon";
  const task = taskForTarget(request.target);
  const mode = modeForTarget(request.target);
  const moduleArg = mode === "module" && request.moduleName
    ? ` -p module=${quoteValue(`${request.moduleName}@${request.product}`)}`
    : "";
  const buildCommand = [
    "./hvigorw",
    task,
    `--mode ${mode}`,
    moduleArg.trim(),
    `-p product=${quoteValue(request.product)}`,
    `-p buildMode=${quoteValue(request.buildMode)}`,
  ].filter(Boolean).join(" ") + daemonArg;
  const command = request.clean
    ? `./hvigorw clean${daemonArg} && ${buildCommand}`
    : buildCommand;

  return {
    label: `Build ${labelForTarget(request.target)} ${request.moduleName ?? "project"} ${request.buildMode}`,
    command,
    cwd: request.rootPath,
    target: request.target,
  };
}
```

- [ ] **Step 5: Add output parser**

Create `src/features/build/build-output-parser.ts`:

```ts
import type { ProblemItem } from "@/features/problems/problems-store";

const fileLocationPattern = /(ERROR|WARN|WARNING)?[^:\n]*(?:File:\s*)?((?:[A-Za-z]:)?[\\/][^\n:]+?\.(?:ets|ts|js|json5|json|hml|css|less|scss)):(\d+):(\d+)(?:\s*(.*))?/i;

function severityFromLine(line: string): ProblemItem["severity"] {
  return /\b(warn|warning)\b/i.test(line) ? "warning" : "error";
}

function cleanMessage(raw: string) {
  return raw.replace(/^[-:\s]+/, "").trim();
}

export function parseBuildProblems(output: string): ProblemItem[] {
  const lines = output.split(/\r?\n/);
  const problems: ProblemItem[] = [];

  lines.forEach((line, index) => {
    const match = line.match(fileLocationPattern);
    if (!match) {
      return;
    }

    const inlineMessage = cleanMessage(match[5] ?? "");
    const nextMessage = cleanMessage(lines[index + 1] ?? "");
    problems.push({
      source: "build",
      severity: severityFromLine(line),
      path: match[2],
      line: Number(match[3]),
      column: Number(match[4]),
      message: inlineMessage || nextMessage || "Build diagnostic",
    });
  });

  return problems;
}
```

- [ ] **Step 6: Add build store**

Create `src/features/build/build-store.ts`:

```ts
import type { BuildRunFinish, BuildState, HarmonyBuildPlan } from "@/features/build/build-model";

export function createBuildStore() {
  const state: BuildState = {
    status: "idle",
    currentRun: null,
    lastTarget: "hap",
    moduleName: "entry",
    product: "default",
    buildMode: "debug",
    fastMode: false,
    output: "",
    problems: [],
    lastExitCode: null,
    lastDurationMs: null,
    message: "No build run yet",
  };

  return {
    state,
    configure(next: Partial<Pick<BuildState, "lastTarget" | "moduleName" | "product" | "buildMode" | "fastMode">>) {
      Object.assign(state, next);
    },
    start(plan: HarmonyBuildPlan & { runId: string }) {
      state.status = "running";
      state.currentRun = plan;
      state.output = "";
      state.problems = [];
      state.lastExitCode = null;
      state.message = plan.label;
    },
    finish(result: BuildRunFinish) {
      state.status = result.stopped ? "stopped" : result.exitCode === 0 ? "success" : "failed";
      state.output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      state.problems = result.problems;
      state.lastExitCode = result.exitCode;
      state.lastDurationMs = result.durationMs;
      state.message = state.status === "success" ? "Build succeeded" : state.status === "stopped" ? "Build stopped" : "Build failed";
      state.currentRun = null;
    },
    fail(message: string) {
      state.status = "failed";
      state.message = message;
      state.currentRun = null;
    },
  };
}
```

- [ ] **Step 7: Allow build problems**

Modify `src/features/problems/problems-store.ts`:

```ts
export type ProblemSource = "lint" | "format" | "language" | "build";
...
const supportedSources: ProblemSource[] = ["lint", "format", "language", "build"];
```

Modify `src/features/workspace/workspace-api.ts`:

```ts
export type ValidationProblem = {
  source: "lint" | "format" | "language" | "build";
  severity: "error" | "warning";
  path: string;
  line: number;
  column: number;
  message: string;
};
```

- [ ] **Step 8: Run domain tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-domain.test.ts
```

Expected: PASS.

### Task 2: Add Build Tool Window UI And AppShell Wiring

**Files:**
- Create: `src/components/layout/BuildToolWindow.tsx`
- Modify: `src/components/layout/shell-state.ts`
- Modify: `src/components/layout/BottomToolWindow.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/ShellStatusBar.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/build-tool-window.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `tests/frontend/build-tool-window.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    pickWorkspaceRoot: async () => "/workspace/Demo",
    openWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: [
        "/workspace/Demo/build-profile.json5",
        "/workspace/Demo/oh-package.json5",
        "/workspace/Demo/hvigorfile.ts",
        "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
      ],
    }),
    openDemoWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: ["/workspace/Demo/entry/src/main/ets/pages/Index.ets"],
    }),
    openFile: async () => "",
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => ({ tools: [] }),
    runTerminalCommand: async (request) => ({
      runId: request.runId,
      command: request.command,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      stopped: false,
    }),
    stopTerminalCommand: async () => undefined,
    createTerminalSession: async () => ({ id: "session-1", title: "zsh", cwd: "/workspace/Demo", shell: "zsh", status: "idle" }),
    listTerminalSessions: async () => [],
    writeTerminalInput: async () => undefined,
    resizeTerminalSession: async () => undefined,
    closeTerminalSession: async () => undefined,
    stopTerminalSession: async () => undefined,
    ...overrides,
  };
}

describe("build tool window", () => {
  it("runs a HAP build from the top bar and shows success status", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({ runTerminalCommand })} />);

    await user.click(screen.getByRole("button", { name: "Run Build" }));

    expect(await screen.findByRole("tab", { name: "Build" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon",
      cwd: "/workspace/Demo",
      source: "preset",
    })));
    expect(screen.getByText("Build succeeded")).toBeInTheDocument();
    expect(screen.getByLabelText("Build Status")).toHaveTextContent("Build succeeded");
  });

  it("parses build diagnostics into Problems after a failed build", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "",
        stderr: "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.",
        exitCode: 1,
        durationMs: 90,
        stopped: false,
      }),
    })} />);

    await user.click(screen.getByRole("button", { name: "Run Build" }));
    await waitFor(() => expect(screen.getByText("Build failed")).toBeInTheDocument());
    await user.click(screen.getByRole("tab", { name: "Problems" }));

    expect(screen.getByText("Property width does not exist.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Problems List")).getByText("build")).toBeInTheDocument();
  });

  it("lets the user stop a running build", async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Awaited<ReturnType<WorkspaceApi["runTerminalCommand"]>>) => void) | null = null;
    const stopTerminalCommand = vi.fn(async () => undefined);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: (request) => new Promise((resolve) => {
        resolveRun = resolve;
        void request;
      }),
      stopTerminalCommand,
    })} />);

    await user.click(screen.getByRole("button", { name: "Run Build" }));
    await user.click(await screen.findByRole("button", { name: "Stop Build" }));

    expect(stopTerminalCommand).toHaveBeenCalled();
    resolveRun?.({
      runId: "build-1",
      command: "",
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 10,
      stopped: true,
    });
  });
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
pnpm exec vitest run tests/frontend/build-tool-window.test.tsx
```

Expected: FAIL because Build UI and shell key do not exist.

- [ ] **Step 3: Add build tool key**

Modify `src/components/layout/shell-state.ts`:

```ts
export type BottomToolKey = "problems" | "terminal" | "build" | "git";
```

- [ ] **Step 4: Add Build panel component**

Create `src/components/layout/BuildToolWindow.tsx` with controls for target, module, product, build mode, fast mode, Run, Clean Build, Stop, status, and output.

- [ ] **Step 5: Wire BottomToolWindow Build tab**

Modify `src/components/layout/BottomToolWindow.tsx`:

```ts
const tabOrder: BottomToolKey[] = ["problems", "terminal", "build", "git"];
const tabLabels: Record<BottomToolKey, string> = {
  problems: "Problems",
  terminal: "Terminal",
  build: "Build",
  git: "Git",
};
```

Add `buildPanel: ReactNode` prop and render a `bottom-tool-panel-build` tabpanel.

- [ ] **Step 6: Add TopBar Build action**

Modify `src/components/layout/TopBar.tsx`:

Add prop:

```ts
onRunBuild: () => void;
```

Add primary toolbar button:

```tsx
<button type="button" aria-label="Run Build" className="toolbar__button toolbar__button--primary" onClick={onRunBuild}>
  <span className="toolbar__icon toolbar__icon--build" aria-hidden="true" />Build
</button>
```

Add Run menu group:

```ts
type MenuKey = "file" | "edit" | "view" | "run";
```

The Run menu contains `Build`, `Clean Build`, and `Stop Build` if supported by the AppShell props.

- [ ] **Step 7: Wire AppShell build lifecycle**

Modify `src/components/layout/AppShell.tsx`:

Add `createBuildStore`, `planHarmonyBuildCommand`, and `parseBuildProblems`.

Add local build state from store.

Add `runBuild(clean = false)`:

```ts
async function runBuild(clean = false) {
  if (!workspace?.rootPath || buildState.status === "running") {
    return;
  }
  const plan = planHarmonyBuildCommand({
    rootPath: workspace.rootPath,
    target: buildState.lastTarget,
    moduleName: buildState.lastTarget === "app" ? null : buildState.moduleName,
    product: buildState.product,
    buildMode: buildState.buildMode,
    clean,
    fastMode: buildState.fastMode,
  });
  const runId = `build-${Date.now()}`;
  buildStoreRef.current.start({ ...plan, runId });
  setBuildState({ ...buildStoreRef.current.state });
  showBottomTool("build");
  const result = await workspaceApi.runTerminalCommand({
    runId,
    command: plan.command,
    cwd: plan.cwd,
    source: "preset",
  });
  const parsedProblems = parseBuildProblems([result.stdout, result.stderr].filter(Boolean).join("\n"));
  buildStoreRef.current.finish({ ...result, problems: parsedProblems });
  problemsRef.current.replace([...problemsRef.current.state.items.filter((item) => item.source !== "build"), ...parsedProblems]);
  setProblems([...problemsRef.current.state.items]);
  setBuildState({ ...buildStoreRef.current.state });
}
```

Add `stopBuild()` using `workspaceApi.stopTerminalCommand(buildState.currentRun.runId)`.

Pass Build panel to BottomToolWindow and `onRunBuild` to TopBar.

- [ ] **Step 8: Add status bar build indicator**

Modify `src/components/layout/ShellStatusBar.tsx` to accept `buildStatus` and `buildMessage`, then render compact status text:

```tsx
<span aria-label="Build Status">{buildMessage}</span>
```

- [ ] **Step 9: Add CSS**

Modify `src/styles/app.css` with restrained IDE styling:

```css
.build-tool-window {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
}

.build-tool-window__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.build-tool-window__output {
  min-height: 0;
  overflow: auto;
  padding: 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
}
```

- [ ] **Step 10: Run UI tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-tool-window.test.tsx
```

Expected: PASS.

### Task 3: Verify Full Frontend And Build

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-domain.test.ts tests/frontend/build-tool-window.test.tsx tests/frontend/problems-store.test.ts tests/frontend/bottom-tool-window.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git status --short
git add docs/superpowers/plans/2026-06-25-arkline-harmony-build-orchestrator.md src tests
git commit -m "feat: add harmony build orchestrator"
```

Expected: commit created on the current branch.

---

## Self Review

Spec coverage:
- Build command orchestration is covered by Task 1.
- Build acceleration foundations are covered by command planning, fast mode, explicit clean, and isolated build domain.
- Problems parsing and jump-compatible diagnostics are covered by Task 1 and Task 2.
- UI build surface, status, run/stop/clean actions are covered by Task 2.
- Long-term maintainability is covered by separating build model/planner/parser/store from terminal UI.

Deferred by design:
- Rust-side Harmony project graph detection is not in this first slice.
- Artifact discovery is not in this first slice.
- Persistent build cache/fingerprint invalidation is not in this first slice.
- Hvigor daemon lifecycle management is exposed as `fastMode` command planning, not yet as a managed background service.
