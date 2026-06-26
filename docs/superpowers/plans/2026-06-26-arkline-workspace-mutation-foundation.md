# ArkLine Workspace Mutation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first durable workspace mutation foundation for file and directory creation, rename, and delete, so ArkLine can later support DevEco Studio-style New Project and template workflows without duplicating filesystem logic.

**Architecture:** Product entry points construct `WorkspaceEditPlan` objects and never write files directly. The existing preview/apply flow remains the only write path. The operation model is extended to include directory operations, and AppShell owns workspace state synchronization after apply.

**Tech Stack:** React 19, TypeScript, Tauri/Rust workspace edit service, Vitest, existing ArkLine WorkspaceEditPreview.

---

## File Structure

- Modify `src/features/code-actions/workspace-edit-model.ts`: add directory operations, affected path collection, validation, summaries.
- Modify `src-tauri/src/models/workspace_edit.rs`: add directory operations to the serialized Rust model.
- Modify `src-tauri/src/services/workspace_edit_service.rs`: validate/apply/preview directory operations.
- Modify `src/features/workspace/workspace-api.ts`: update fallback preview summary for directory operations.
- Create `src/features/workspace/workspace-mutation-plans.ts`: intent builders for new file, new directory, rename, delete.
- Modify `src/components/layout/ProjectToolWindow.tsx`: expose tree actions and emit mutation intents.
- Modify `src/components/layout/AppShell.tsx`: receive tree actions, preview plans, apply state sync for directory operations.
- Modify `src/components/layout/TopBar.tsx`: add File menu entries for New File and New Directory.
- Modify `src/components/layout/app-shell-helpers.ts`: add Command Palette entries.
- Modify `src/styles/app.css`: style compact project mutation controls/dialogs.
- Test `tests/frontend/workspace-edit-model.test.ts`: operation model coverage.
- Test `tests/frontend/app-shell.test.tsx`: UI entry points and preview/apply integration.
- Test `src-tauri/src/services/workspace_edit_service.rs`: Rust directory validation and apply coverage.

---

### Task 1: Extend WorkspaceEdit Operation Model

**Files:**
- Modify: `src/features/code-actions/workspace-edit-model.ts`
- Test: `tests/frontend/workspace-edit-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Add directory operations to `collectAffectedFiles` and summaries:

```ts
expect(summarizeWorkspaceEditOperation({
  kind: "createDirectory",
  path: "src/pages",
})).toBe("Create directory src/pages");

expect(summarizeWorkspaceEditOperation({
  kind: "renameDirectory",
  oldPath: "src/old",
  newPath: "src/new",
  overwrite: false,
})).toBe("Rename directory src/old to src/new");

expect(summarizeWorkspaceEditOperation({
  kind: "deleteDirectory",
  path: "src/generated",
  recursive: true,
})).toBe("Delete directory src/generated recursively");
```

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/workspace-edit-model.test.ts --reporter=dot
```

Expected: FAIL because directory operation types do not exist.

- [ ] **Step 2: Add TypeScript operation variants**

Add:

```ts
| { kind: "createDirectory"; path: string }
| { kind: "renameDirectory"; oldPath: string; newPath: string; overwrite: boolean }
| { kind: "deleteDirectory"; path: string; recursive: boolean }
```

Update `collectOperationFiles` and `summarizeWorkspaceEditOperation`.

- [ ] **Step 3: Verify model tests pass**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/workspace-edit-model.test.ts --reporter=dot
```

Expected: PASS.

---

### Task 2: Add Rust Workspace Edit Directory Runtime

**Files:**
- Modify: `src-tauri/src/models/workspace_edit.rs`
- Modify: `src-tauri/src/services/workspace_edit_service.rs`

- [ ] **Step 1: Write failing Rust service tests**

Add tests for:

- preview create directory.
- apply create directory.
- reject create directory target that is an existing file.
- reject rename directory source that is a file.
- apply delete directory recursively.

Run:

```bash
cargo test workspace_edit_service --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL because operation variants do not exist.

- [ ] **Step 2: Add Rust enum variants**

Add `CreateDirectory`, `RenameDirectory`, and `DeleteDirectory` to `WorkspaceEditOperation`.

- [ ] **Step 3: Add validation**

Rules:

- target path must remain under workspace root.
- createDirectory parent must exist.
- createDirectory target must not be a file.
- renameDirectory source must exist and be directory.
- renameDirectory target must not be file.
- deleteDirectory target must exist and be directory.
- deleteDirectory cannot delete workspace root.

- [ ] **Step 4: Add apply support**

Use:

- `std::fs::create_dir`
- `std::fs::rename`
- `std::fs::remove_dir_all` when recursive.
- `std::fs::remove_dir` when non-recursive.

- [ ] **Step 5: Verify Rust tests pass**

Run:

```bash
cargo test workspace_edit_service --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

---

### Task 3: Add Mutation Intent Builders

**Files:**
- Create: `src/features/workspace/workspace-mutation-plans.ts`
- Test: `tests/frontend/workspace-mutation-plans.test.ts`

- [ ] **Step 1: Write failing builder tests**

Cover:

- `createNewFilePlan`
- `createNewDirectoryPlan`
- `createRenamePathPlan`
- `createDeletePathPlan`
- rejects empty names.
- rejects names containing `/` or `\`.

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/workspace-mutation-plans.test.ts --reporter=dot
```

Expected: FAIL because builder file does not exist.

- [ ] **Step 2: Implement builder module**

Export:

```ts
export type WorkspacePathKind = "file" | "directory";

export function createNewFilePlan(parentPath: string, name: string): WorkspaceEditPlan
export function createNewDirectoryPlan(parentPath: string, name: string): WorkspaceEditPlan
export function createRenamePathPlan(path: string, kind: WorkspacePathKind, newName: string): WorkspaceEditPlan
export function createDeletePathPlan(path: string, kind: WorkspacePathKind): WorkspaceEditPlan
```

- [ ] **Step 3: Verify builder tests pass**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/workspace-mutation-plans.test.ts --reporter=dot
```

Expected: PASS.

---

### Task 4: Wire Project Tree Actions To Preview

**Files:**
- Modify: `src/components/layout/ProjectToolWindow.tsx`
- Modify: `src/components/layout/ShellSidebar.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add tests:

- right-click or action button on directory opens New File dialog.
- confirming New File calls `previewWorkspaceEdit` with `createFile`.
- confirming New Directory calls `previewWorkspaceEdit` with `createDirectory`.
- Delete directory preview uses `deleteDirectory` with `recursive: true`.

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/app-shell.test.tsx --reporter=dot
```

Expected: FAIL because tree actions do not exist.

- [ ] **Step 2: Add ProjectToolWindow action model**

Add prop:

```ts
onRequestMutation: (request: ProjectMutationRequest) => void;
```

Define:

```ts
type ProjectMutationRequest =
  | { action: "newFile"; parentPath: string }
  | { action: "newDirectory"; parentPath: string }
  | { action: "rename"; path: string; kind: "file" | "directory" }
  | { action: "delete"; path: string; kind: "file" | "directory" };
```

- [ ] **Step 3: Add compact dialog state in AppShell**

Track:

```ts
type ProjectMutationDialogState =
  | { kind: "newFile"; parentPath: string; name: string }
  | { kind: "newDirectory"; parentPath: string; name: string }
  | { kind: "rename"; path: string; pathKind: "file" | "directory"; name: string }
  | { kind: "delete"; path: string; pathKind: "file" | "directory" };
```

- [ ] **Step 4: Submit dialogs through mutation builders**

On submit:

- build plan.
- call `previewWorkspaceEdit`.
- close dialog.
- show `WorkspaceEditPreview`.

- [ ] **Step 5: Verify UI tests pass**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/app-shell.test.tsx --reporter=dot
```

Expected: PASS for new tests.

---

### Task 5: Add Menu And Command Palette Entrypoints

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/app-shell-helpers.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing entrypoint tests**

Add tests:

- File menu has `New File` and `New Directory`.
- Command Palette has `New File` and `New Directory`.
- Triggering them defaults parent to workspace root.

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/app-shell.test.tsx --reporter=dot
```

Expected: FAIL until menu and palette entries exist.

- [ ] **Step 2: Add menu props and actions**

Add:

```ts
onNewFile: () => void;
onNewDirectory: () => void;
```

Place them at the top of File menu.

- [ ] **Step 3: Add command palette actions**

Add:

```ts
{ id: "new-file", label: "New File", action: actions.newFile }
{ id: "new-directory", label: "New Directory", action: actions.newDirectory }
```

- [ ] **Step 4: Verify entrypoint tests pass**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/app-shell.test.tsx --reporter=dot
```

Expected: PASS.

---

### Task 6: Final Verification And Commit

**Files:**
- All modified files above.

- [ ] **Step 1: Run focused frontend tests**

```bash
./node_modules/.bin/vitest run tests/frontend/workspace-edit-model.test.ts tests/frontend/workspace-mutation-plans.test.ts tests/frontend/app-shell.test.tsx --reporter=dot
```

Expected: PASS.

- [ ] **Step 2: Run Rust service tests**

```bash
cargo test workspace_edit_service --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Run available build checks**

```bash
pnpm build
```

Expected: May still fail on existing test mock type issues unrelated to this slice. If so, record exact errors.

- [ ] **Step 4: Inspect diff**

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only planned files changed; diff check passes.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-26-arkline-workspace-mutation-foundation-design.md docs/superpowers/plans/2026-06-26-arkline-workspace-mutation-foundation.md src src-tauri tests
git commit -m "feat: add workspace mutation foundation"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: The plan covers operation model, runtime apply, UI tree entrypoints, menu/palette entrypoints, validation, and verification.
- Scope control: Full New Project Wizard is intentionally deferred; the foundation is required first.
- Placeholder scan: No placeholder tasks remain.
- Type consistency: `createDirectory`, `renameDirectory`, and `deleteDirectory` names are consistent across TypeScript, Rust, and tests.
