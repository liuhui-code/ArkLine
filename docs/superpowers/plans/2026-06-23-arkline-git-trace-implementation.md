# ArkLine Git Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IDEA-style line-level Git trace for the active saved file, with inline blame summaries and a bottom `Git Trace` panel that shows commit metadata and file-scoped patch context.

**Architecture:** Keep Git access behind the existing workspace API and Tauri boundary. Add a focused Git trace data model, a dedicated bottom-panel presenter, and a small editor-side blame rendering layer so `AppShell` only coordinates state and navigation instead of owning Git parsing or editor decoration logic.

**Tech Stack:** React 19, CodeMirror 6, TypeScript, Rust, Tauri v2, Vitest, Testing Library

---

### Task 1: Define the Git trace frontend contract

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src/features/git/git-trace-model.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/language-service-api.test.ts`

- [ ] **Step 1: Write the failing API contract test**

Add a new test in `/Users/liuhui/Documents/code/ArkLine/tests/frontend/language-service-api.test.ts` that exercises the default workspace API contract shape for Git trace methods:

```ts
it("exposes git trace contract shapes", async () => {
  const blame = await defaultWorkspaceApi.getFileBlame?.("C:/samples/DemoWorkspace/src/main.ets");
  const detail = await defaultWorkspaceApi.getCommitTrace?.("C:/samples/DemoWorkspace/src/main.ets", "abc1234", 3);

  expect(blame).toBeDefined();
  expect(detail).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/language-service-api.test.ts
```

Expected: FAIL because `getFileBlame` and `getCommitTrace` do not exist yet.

- [ ] **Step 3: Add the shared Git trace model and workspace API methods**

Create `/Users/liuhui/Documents/code/ArkLine/src/features/git/git-trace-model.ts` with the shared types:

```ts
export type GitTraceUnavailableReason =
  | "gitUnavailable"
  | "notTracked"
  | "notRepository"
  | "unsaved"
  | "detailUnavailable";

export type GitTraceUnavailable = {
  kind: "unavailable";
  reason: GitTraceUnavailableReason;
  message: string;
};

export type GitBlameLine = {
  line: number;
  commit: string;
  sourceLine: number;
  author: string;
  authoredAt: string;
  relativeTime: string;
  summary: string;
};

export type GitCommitTrace = {
  commit: string;
  shortCommit: string;
  author: string;
  email?: string;
  authoredAt: string;
  subject: string;
  relativePath: string;
  selectedLine: number;
  sourceLine: number;
  patch: string;
};
```

Modify `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts` to:

- import these types
- extend `WorkspaceApi` with:

```ts
getFileBlame?(path: string): Promise<GitBlameLine[] | GitTraceUnavailable>;
getCommitTrace?(path: string, commit: string, line: number): Promise<GitCommitTrace | GitTraceUnavailable>;
```

- add mock/demo implementations in `defaultWorkspaceApi` that return stable sample data for demo workspace paths and unavailable results otherwise

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/language-service-api.test.ts
```

Expected: PASS with the new Git trace contract exposed.

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  src/features/git/git-trace-model.ts \
  src/features/workspace/workspace-api.ts \
  tests/frontend/language-service-api.test.ts
git -C /Users/liuhui/Documents/code/ArkLine commit -m "feat: add git trace workspace api contract"
```

### Task 2: Add the backend Git trace service and Tauri commands

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/git_trace_service.rs`
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/commands/git_trace.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/lib.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/language.rs`
- Test: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/git_trace_service.rs`

- [ ] **Step 1: Write the failing Rust parsing tests**

In `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/git_trace_service.rs`, add unit tests first for:

- parsing `git blame --line-porcelain`
- extracting commit summary fields
- preserving file-scoped patch text

Use inline fixtures such as:

```rust
let blame_fixture = "\
abc1234 3 3 1
author Jane Doe
author-mail <jane@example.com>
author-time 1719120000
summary Add ArkLine label
\tText(\"ArkLine\")";
```

- [ ] **Step 2: Run Rust test to verify it fails**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && cargo test git_trace_service
```

Expected: FAIL because the service module does not exist yet.

- [ ] **Step 3: Implement the Git trace service and commands**

Create `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/git_trace_service.rs` with:

- a `GitTraceService` that shells out to:
  - `git blame --line-porcelain -- <file>`
  - `git show <commit> -- <file>`
- parser helpers that map CLI output into serializable structs
- unavailability mapping for:
  - Git missing
  - not a repository
  - untracked file

Create `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/commands/git_trace.rs` with Tauri commands:

```rust
#[tauri::command]
pub fn get_file_blame(path: String) -> Result<GitTraceBlameResponse, String> { ... }

#[tauri::command]
pub fn get_commit_trace(path: String, commit: String, line: usize) -> Result<GitCommitTraceResponse, String> { ... }
```

Wire the command module into `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/lib.rs` and add the serializable response structs to the existing models file if that is the current project pattern.

- [ ] **Step 4: Run Rust test to verify it passes**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && cargo test git_trace_service
```

Expected: PASS with parsing and unavailable-state coverage.

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  src-tauri/src/services/git_trace_service.rs \
  src-tauri/src/commands/git_trace.rs \
  src-tauri/src/lib.rs \
  src-tauri/src/models/language.rs
git -C /Users/liuhui/Documents/code/ArkLine commit -m "feat: add tauri git trace service"
```

### Task 3: Add the Git Trace panel and shell state

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/GitTracePanel.tsx`
- Create: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/use-git-trace.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/BottomToolWindow.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/shell-state.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing AppShell test for Git Trace panel behavior**

Add a new test to `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`:

```ts
it("opens Git Trace after selecting a blamed line", async () => {
  // render AppShell with mocked getFileBlame/getCommitTrace
  // open workspace and file
  // click blame row
  // assert bottom tab switches to Git Trace
  // assert commit summary and patch text appear
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Git Trace"
```

Expected: FAIL because no Git Trace panel or shell state exists yet.

- [ ] **Step 3: Implement shell-side Git Trace state and panel**

Create `/Users/liuhui/Documents/code/ArkLine/src/components/layout/use-git-trace.ts` to own:

- blame load state for the active file
- selected blame line
- commit-detail load state
- open-panel coordination helpers

Create `/Users/liuhui/Documents/code/ArkLine/src/components/layout/GitTracePanel.tsx` to render:

- loading state
- unavailable state
- commit summary
- line context
- patch preview
- `Open in Editor`
- `Open Commit Diff`

Modify:

- `/Users/liuhui/Documents/code/ArkLine/src/components/layout/shell-state.ts`
  - add `gitTrace` to bottom tool keys
- `/Users/liuhui/Documents/code/ArkLine/src/components/layout/BottomToolWindow.tsx`
  - add a `Git Trace` tab and panel slot
- `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
  - wire `use-git-trace`
  - pass panel props
  - route `Open Commit Diff` through the existing Git diff viewer path
- `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`
  - add dedicated `git-trace-*` styles without overloading existing Git diff styles

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Git Trace"
```

Expected: PASS with the new panel behavior.

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  src/components/layout/GitTracePanel.tsx \
  src/components/layout/use-git-trace.ts \
  src/components/layout/BottomToolWindow.tsx \
  src/components/layout/AppShell.tsx \
  src/components/layout/shell-state.ts \
  src/styles/app.css \
  tests/frontend/app-shell.test.tsx
git -C /Users/liuhui/Documents/code/ArkLine commit -m "feat: add git trace panel and shell state"
```

### Task 4: Add editor blame rendering and click-through

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src/editor/git-trace-decorations.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/editor/editor-extensions.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/editor/ArkTsEditor.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/EditorSurface.tsx`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/editor.test.tsx`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing editor-side blame test**

Add a focused test in `/Users/liuhui/Documents/code/ArkLine/tests/frontend/editor.test.tsx` that mounts the editor with blame data and asserts:

- blame labels render alongside lines
- clicking a label triggers the line-selection callback

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/editor.test.tsx --testNamePattern "blame"
```

Expected: FAIL because no blame rendering extension exists yet.

- [ ] **Step 3: Implement blame decorations and click mapping**

Create `/Users/liuhui/Documents/code/ArkLine/src/editor/git-trace-decorations.ts` with:

- CodeMirror decoration helpers or gutter markers for blame labels
- selected-line highlighting support
- click handlers that map a label back to a source line

Modify:

- `/Users/liuhui/Documents/code/ArkLine/src/editor/editor-extensions.ts`
  - add optional blame extension wiring
- `/Users/liuhui/Documents/code/ArkLine/src/editor/ArkTsEditor.tsx`
  - pass blame data and blame-click callback
- `/Users/liuhui/Documents/code/ArkLine/src/components/layout/EditorSurface.tsx`
  - thread blame props between shell and editor

- [ ] **Step 4: Run the focused editor and shell tests**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/editor.test.tsx --testNamePattern "blame"
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Git Trace"
```

Expected: PASS with blame rendering and click-through integrated.

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  src/editor/git-trace-decorations.ts \
  src/editor/editor-extensions.ts \
  src/editor/ArkTsEditor.tsx \
  src/components/layout/EditorSurface.tsx \
  tests/frontend/editor.test.tsx \
  tests/frontend/app-shell.test.tsx
git -C /Users/liuhui/Documents/code/ArkLine commit -m "feat: render git blame in editor"
```

### Task 5: Degraded states, regression verification, and docs

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/language-service-api.test.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/gitlog.md`
- Modify: `/Users/liuhui/Documents/code/ArkLine/README.md`

- [ ] **Step 1: Add degraded-state tests**

Extend `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx` with cases for:

- file is untracked
- Git unavailable
- unsaved file disables refresh with a clear message

Extend `/Users/liuhui/Documents/code/ArkLine/tests/frontend/language-service-api.test.ts` or add a nearby focused API test for typed unavailable responses.

- [ ] **Step 2: Run focused frontend verification**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Git Trace|untracked|Git unavailable|unsaved"
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/editor.test.tsx --testNamePattern "blame"
cd /Users/liuhui/Documents/code/ArkLine && pnpm exec vitest run tests/frontend/language-service-api.test.ts
```

Expected: PASS across the focused Git trace frontend suite.

- [ ] **Step 3: Run build and Rust verification**

Run:

```bash
cd /Users/liuhui/Documents/code/ArkLine && cargo test git_trace_service
cd /Users/liuhui/Documents/code/ArkLine && pnpm build
```

Expected:

- Rust Git trace tests PASS
- production build PASS

- [ ] **Step 4: Update docs**

Update:

- `/Users/liuhui/Documents/code/ArkLine/gitlog.md`
  - record the Git Trace feature and verification
- `/Users/liuhui/Documents/code/ArkLine/README.md`
  - add a short note that ArkLine now supports line-level Git trace for saved Git-tracked files

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  tests/frontend/app-shell.test.tsx \
  tests/frontend/language-service-api.test.ts \
  gitlog.md \
  README.md
git -C /Users/liuhui/Documents/code/ArkLine commit -m "test: verify git trace degraded states"
```
