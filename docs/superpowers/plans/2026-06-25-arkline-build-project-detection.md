# ArkLine Build Project Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Build choose the correct HarmonyOS module automatically from the opened workspace and active file, reducing accidental project-wide builds and preparing the build system for real incremental acceleration.

**Architecture:** Add a frontend build project detector that derives a lightweight `HarmonyBuildProject` from the workspace root and visible files. AppShell owns the detected project and active module synchronization, while `BuildToolWindow` renders module choices instead of free-form text.

**Tech Stack:** React, TypeScript, Vitest, existing frontend build domain, existing AppShell workspace state.

---

### Task 1: Build Project Detector

**Files:**
- Create: `src/features/build/build-project-detector.ts`
- Modify: `src/features/build/build-model.ts`
- Test: `tests/frontend/build-project-detector.test.ts`

- [ ] **Step 1: Write failing detector tests**

Create `tests/frontend/build-project-detector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  detectHarmonyBuildProject,
  inferBuildModuleForPath,
} from "@/features/build/build-project-detector";

describe("Harmony build project detector", () => {
  const files = [
    "/workspace/Demo/build-profile.json5",
    "/workspace/Demo/hvigorfile.ts",
    "/workspace/Demo/oh-package.json5",
    "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
    "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
    "/workspace/Demo/common/src/main/ets/Common.ets",
  ];

  it("detects HarmonyOS project markers and modules from visible workspace files", () => {
    expect(detectHarmonyBuildProject("/workspace/Demo", files)).toEqual({
      rootPath: "/workspace/Demo",
      isHarmonyProject: true,
      hasHvigorWrapper: false,
      hasHvigorFile: true,
      hasBuildProfile: true,
      hasOhPackage: true,
      modules: ["common", "entry", "feature"],
      defaultModule: "entry",
    });
  });

  it("infers the module for an active file under module/src/main", () => {
    const project = detectHarmonyBuildProject("/workspace/Demo", files);

    expect(inferBuildModuleForPath(project, "/workspace/Demo/feature/src/main/ets/pages/Feature.ets")).toBe("feature");
    expect(inferBuildModuleForPath(project, "/workspace/Demo/entry/src/main/ets/pages/Index.ets")).toBe("entry");
  });

  it("falls back to the default module for project-level files", () => {
    const project = detectHarmonyBuildProject("/workspace/Demo", files);

    expect(inferBuildModuleForPath(project, "/workspace/Demo/build-profile.json5")).toBe("entry");
  });
});
```

- [ ] **Step 2: Run detector tests to confirm red**

Run:

```bash
pnpm exec vitest run tests/frontend/build-project-detector.test.ts
```

Expected: FAIL because detector module does not exist.

- [ ] **Step 3: Add model types**

Modify `src/features/build/build-model.ts`:

```ts
export type HarmonyBuildProject = {
  rootPath: string;
  isHarmonyProject: boolean;
  hasHvigorWrapper: boolean;
  hasHvigorFile: boolean;
  hasBuildProfile: boolean;
  hasOhPackage: boolean;
  modules: string[];
  defaultModule: string | null;
};
```

- [ ] **Step 4: Implement detector**

Create `src/features/build/build-project-detector.ts`:

```ts
import type { HarmonyBuildProject } from "@/features/build/build-model";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

function relativePath(rootPath: string, path: string) {
  const root = normalizePath(rootPath).replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = normalizePath(path).replace(/\\/g, "/");

  if (!normalized.startsWith(`${root}/`)) {
    return normalized;
  }

  return normalized.slice(root.length + 1);
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function detectModules(rootPath: string, files: string[]) {
  return uniqueSorted(files
    .map((file) => relativePath(rootPath, file))
    .map((file) => file.split("/"))
    .filter((segments) => segments.length > 3 && segments[1] === "src" && segments[2] === "main")
    .map((segments) => segments[0])
    .filter(Boolean));
}

export function detectHarmonyBuildProject(rootPath: string, files: string[]): HarmonyBuildProject {
  const relativeFiles = files.map((file) => relativePath(rootPath, file));
  const modules = detectModules(rootPath, files);
  const hasHvigorWrapper = relativeFiles.some((file) => getPathBasename(file) === "hvigorw" || getPathBasename(file) === "hvigorw.bat");
  const hasHvigorFile = relativeFiles.includes("hvigorfile.ts");
  const hasBuildProfile = relativeFiles.includes("build-profile.json5");
  const hasOhPackage = relativeFiles.includes("oh-package.json5");
  const isHarmonyProject = hasHvigorFile || hasBuildProfile || hasOhPackage || modules.length > 0;
  const defaultModule = modules.includes("entry") ? "entry" : modules[0] ?? null;

  return {
    rootPath: normalizePath(rootPath),
    isHarmonyProject,
    hasHvigorWrapper,
    hasHvigorFile,
    hasBuildProfile,
    hasOhPackage,
    modules,
    defaultModule,
  };
}

export function inferBuildModuleForPath(project: HarmonyBuildProject | null, path: string | null): string | null {
  if (!project) {
    return null;
  }

  if (path) {
    const relative = relativePath(project.rootPath, path);
    const segments = relative.split("/");
    if (segments.length > 3 && segments[1] === "src" && segments[2] === "main" && project.modules.includes(segments[0])) {
      return segments[0];
    }
  }

  return project.defaultModule;
}
```

- [ ] **Step 5: Run detector tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-project-detector.test.ts
```

Expected: PASS.

### Task 2: Module-Aware Build UI And AppShell Sync

**Files:**
- Modify: `src/components/layout/BuildToolWindow.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/build-tool-window.test.tsx`

- [ ] **Step 1: Add failing UI tests**

Modify `tests/frontend/build-tool-window.test.tsx` to add:

```ts
it("uses the active file module for HAP builds", async () => {
  const user = userEvent.setup();
  const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
  render(<AppShell workspaceApi={createWorkspaceApi({
    runTerminalCommand,
    openWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: [
        "/workspace/Demo/build-profile.json5",
        "/workspace/Demo/hvigorfile.ts",
        "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
      ],
    }),
  })} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "Feature.ets" }));
  await user.click(screen.getByRole("button", { name: "Run Build" }));

  await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
    command: "./hvigorw assembleHap --mode module -p module=feature@default -p product=default -p buildMode=debug --no-daemon",
  })));
});

it("shows detected modules as module choices", async () => {
  const user = userEvent.setup();
  render(<AppShell workspaceApi={createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: [
        "/workspace/Demo/build-profile.json5",
        "/workspace/Demo/hvigorfile.ts",
        "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
      ],
    }),
  })} />);

  await openProject(user);
  await user.click(screen.getByRole("button", { name: "Build" }));

  const moduleSelect = await screen.findByLabelText("Build Module");
  expect(within(moduleSelect).getByRole("option", { name: "entry" })).toBeInTheDocument();
  expect(within(moduleSelect).getByRole("option", { name: "feature" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests to confirm red**

Run:

```bash
pnpm exec vitest run tests/frontend/build-tool-window.test.tsx
```

Expected: FAIL because module select and active-file inference are not implemented.

- [ ] **Step 3: Update BuildToolWindow props**

Modify `src/components/layout/BuildToolWindow.tsx`:

- Add `modules: string[]`
- Replace the `Module` text input with a select:

```tsx
<label className="build-tool-window__field">
  <span>Module</span>
  <select aria-label="Build Module" value={state.moduleName} disabled={running || state.lastTarget === "app"} onChange={(event) => onChangeModuleName(event.target.value)}>
    {(modules.length > 0 ? modules : [state.moduleName || "entry"]).map((moduleName) => (
      <option key={moduleName} value={moduleName}>{moduleName}</option>
    ))}
  </select>
</label>
```

- [ ] **Step 4: Sync detected project in AppShell**

Modify `src/components/layout/AppShell.tsx`:

- Import `detectHarmonyBuildProject` and `inferBuildModuleForPath`
- Add memo:

```ts
const buildProject = useMemo(
  () => workspace ? detectHarmonyBuildProject(workspace.rootPath, workspace.visibleFiles) : null,
  [workspace],
);
```

- Add effect:

```ts
useEffect(() => {
  const nextModule = inferBuildModuleForPath(buildProject, activePath);
  if (!nextModule || buildStoreRef.current.state.status === "running") {
    return;
  }
  if (buildStoreRef.current.state.moduleName !== nextModule) {
    buildStoreRef.current.configure({ moduleName: nextModule });
    setBuildState({ ...buildStoreRef.current.state });
  }
}, [activePath, buildProject]);
```

- Pass `modules={buildProject?.modules ?? []}` into `BuildToolWindow`.

- [ ] **Step 5: Run UI tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-tool-window.test.tsx
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**
- No new source files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/frontend/build-project-detector.test.ts tests/frontend/build-domain.test.ts tests/frontend/build-tool-window.test.tsx
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
git add docs/superpowers/plans/2026-06-25-arkline-build-project-detection.md src tests
git commit -m "feat: detect harmony build modules"
```

Expected: commit created on current branch.

---

## Self Review

Spec coverage:
- Harmony project detection is covered by Task 1.
- Module inference from active file is covered by Task 1 and Task 2.
- Build panel module select is covered by Task 2.
- Faster build target selection is covered by AppShell using inferred module in Run Build.

Deferred by design:
- Parsing `build-profile.json5` contents is deferred until module inference from paths proves insufficient.
- Rust-side workspace scanning is deferred to avoid duplicating the existing frontend workspace model too early.
- Artifact discovery, persistent fingerprints, and daemon lifecycle management remain later Build M4 work.
