# ArkLine IDE/CLI Code Action Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared Code Action + Workspace Edit platform so the IDE UI and CLI can expose the same quick edit, refactor, rename, and template-generation capabilities without duplicating logic.

**Architecture:** Keep language understanding in provider layers, edit planning in a shared platform model, filesystem application in Tauri/CLI runtimes, and presentation in IDE/CLI-specific adapters. The CLI must remain a first-class interface that can inspect actions, resolve edits, preview JSON/diff output, and apply safe workspace edits using the same contracts as the IDE.

**Tech Stack:** TypeScript semantic worker, React/Tauri v2, Rust services, Node CLI wrapper, Vitest, Rust unit tests, CodeMirror, existing ArkLine workspace/document stores.

---

## Scope

This plan intentionally builds the platform before advanced refactorings. It preserves current IDE behavior and adds CLI-capable interfaces first, then wires a small set of low-risk actions through both surfaces.

In scope:
- Shared action and edit models.
- CLI commands for language capabilities and edit plans.
- IDE command integration for action discovery and preview.
- Workspace edit preview and application runtime.
- Initial actions: rename file, generate ArkTS page/component, simple source action examples.

Out of scope for this plan:
- Full Extract Method implementation.
- Full Change Signature / Safe Delete / Move Symbol.
- AI-generated edits.
- Replacing semantic-worker with a full ArkTS LSP.

## Current State

- `semantic-worker/src/protocol.ts` only supports `health`, `gotoDefinition`, and `completion`.
- `semantic-worker/src/session.ts` dispatches only those three request kinds.
- `src/features/workspace/workspace-api.ts` exposes IDE language calls, but no `listCodeActions`, `resolveCodeAction`, `previewWorkspaceEdit`, or `applyWorkspaceEdit`.
- `src-tauri/src/commands/language.rs` exposes language read operations only.
- `src-tauri/src/services/document_service.rs` can read and write text files, but cannot apply multi-file edit plans, rename files, create files from templates, or guard workspace-root boundaries.
- `package.json` has semantic worker build/test scripts and `scripts/smoke-semantic.mjs`, but no formal CLI entry for the IDE language/edit platform.

## Design Principles

1. **One capability contract, multiple frontends**
   - IDE and CLI must call the same conceptual API.
   - The CLI is not a debug-only wrapper; it is a supported automation surface.

2. **Providers produce plans, runtimes apply plans**
   - Semantic providers return `CodeAction` and `WorkspaceEditPlan`.
   - Providers never write files directly.
   - IDE/Tauri and CLI runtimes apply edits after validation.

3. **Preview before risky writes**
   - Cross-file edits always support preview.
   - CLI defaults to dry-run for edit-producing commands.
   - IDE shows Refactor Preview before applying multi-file or risky edits.

4. **Workspace-root safety**
   - All file operations must stay inside the opened workspace root.
   - SDK and generated dependency directories are readonly by default.

5. **Stable JSON over clever UI coupling**
   - CLI output uses stable JSON contracts.
   - IDE can render richer UI from the same JSON.

---

## File Structure

### Shared TypeScript Model

- Create: `src/features/code-actions/code-action-model.ts`
  - Defines IDE-facing `CodeAction`, `WorkspaceEditPlan`, `WorkspaceEditOperation`, `EditConflict`, and helpers.
- Create: `src/features/code-actions/workspace-edit-model.ts`
  - Pure functions for sorting operations, validating ranges, and summarizing affected files.
- Test: `tests/frontend/code-action-model.test.ts`
- Test: `tests/frontend/workspace-edit-model.test.ts`

### Semantic Worker Protocol

- Modify: `semantic-worker/src/protocol.ts`
  - Adds `listCodeActions`, `resolveCodeAction`, `prepareRename`, `rename`, and shared edit payload types.
- Modify: `semantic-worker/src/session.ts`
  - Routes new request methods.
- Create: `semantic-worker/src/features/code-actions.ts`
  - Provides initial deterministic actions.
- Create: `semantic-worker/src/features/templates.ts`
  - Provides ArkTS template generation actions.
- Test: `semantic-worker/src/__tests__/code-actions.test.ts`
- Test: `semantic-worker/src/__tests__/templates.test.ts`

### CLI Surface

- Create: `scripts/arkline-cli.mjs`
  - Node CLI for `language inspect`, `definition`, `completion`, `actions`, `resolve-action`, `rename-file`, `generate`.
- Modify: `package.json`
  - Adds `arkline` bin or scripts for local usage.
- Test: `tests/frontend/arkline-cli.test.ts`
  - Uses child process execution or a pure argument parser helper.
- Create: `scripts/arkline-cli/cli-parser.mjs`
  - Keeps command parsing testable without spawning Node for every unit test.
- Create: `scripts/arkline-cli/semantic-client.mjs`
  - Talks to semantic worker over stdio.

### Rust/Tauri Runtime

- Modify: `src-tauri/src/models/language.rs`
  - Adds Rust-side code action and workspace edit DTOs.
- Create: `src-tauri/src/models/workspace_edit.rs`
  - Defines file/text operation DTOs if language model becomes too large.
- Modify: `src-tauri/src/services/document_service.rs`
  - Adds atomic-ish workspace edit application helpers.
- Create: `src-tauri/src/services/workspace_edit_service.rs`
  - Root validation, conflict detection, preview summaries, and apply runtime.
- Create: `src-tauri/src/commands/code_actions.rs`
  - Tauri commands for list/resolve/preview/apply.
- Modify: `src-tauri/src/lib.rs`
  - Registers new commands.
- Test: Rust unit tests in `workspace_edit_service.rs`.

### IDE UI

- Modify: `src/features/workspace/workspace-api.ts`
  - Adds code action and edit APIs.
- Create: `src/components/layout/CodeActionsPalette.tsx`
  - `Alt+Enter` action picker.
- Create: `src/components/layout/WorkspaceEditPreview.tsx`
  - IDE preview surface for action edit plans.
- Modify: `src/components/layout/AppShell.tsx`
  - Orchestrates action discovery, preview, and apply.
- Modify: `src/components/layout/shell-keymap.ts`
  - Adds `showCodeActions`, `renameSymbol`, `generateCode`, `refactorThis`.
- Modify: `src/components/layout/app-shell-helpers.ts`
  - Adds command palette entries.
- Test: `tests/frontend/app-shell.test.tsx`
- Test: `tests/frontend/shell-hotkeys.test.tsx`

---

## Shared Contracts

### `CodeAction`

```ts
export type CodeActionKind =
  | "quickfix"
  | "refactor.extract"
  | "refactor.inline"
  | "refactor.rewrite"
  | "source"
  | "generate"
  | "template";

export type CodeActionSafety = "safe" | "needsPreview" | "risky";

export type CodeAction = {
  id: string;
  title: string;
  kind: CodeActionKind;
  provider: "arkts" | "workspace" | "template" | "fallback";
  safety: CodeActionSafety;
  disabledReason?: string;
  editId?: string;
  data?: Record<string, unknown>;
};
```

### `WorkspaceEditPlan`

```ts
export type WorkspaceEditPlan = {
  id: string;
  title: string;
  operations: WorkspaceEditOperation[];
  conflicts: EditConflict[];
  affectedFiles: string[];
  undoLabel: string;
  requiresPreview: boolean;
};

export type WorkspaceEditOperation =
  | { kind: "text"; path: string; range: TextRange; newText: string; expectedVersion?: number }
  | { kind: "createFile"; path: string; content: string; overwrite: boolean }
  | { kind: "renameFile"; oldPath: string; newPath: string; overwrite: boolean }
  | { kind: "deleteFile"; path: string; recursive: boolean };
```

### CLI Output Policy

Every CLI command supports:
- `--json`: machine-readable output.
- `--pretty`: human-readable output.
- `--dry-run`: default for edit-producing commands.
- `--apply`: required to write.
- `--workspace <path>`: workspace root.
- `--file <path>`: target file.
- `--line <n> --column <n>`: cursor position when needed.

---

## Task 1: Add Shared Code Action and Workspace Edit Models

**Files:**
- Create: `src/features/code-actions/code-action-model.ts`
- Create: `src/features/code-actions/workspace-edit-model.ts`
- Test: `tests/frontend/code-action-model.test.ts`
- Test: `tests/frontend/workspace-edit-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Create tests that verify:
- action kinds are grouped into user-visible families;
- workspace edit affected files are stable and deduplicated;
- text edit ranges reject inverted positions;
- file operations are summarized correctly.

Run:

```bash
pnpm exec vitest run tests/frontend/code-action-model.test.ts tests/frontend/workspace-edit-model.test.ts
```

Expected:
- FAIL because files do not exist.

- [ ] **Step 2: Implement minimal shared model**

Create pure TypeScript models and helpers:
- `formatCodeActionKind(kind)`
- `requiresPreview(action)`
- `collectAffectedFiles(plan)`
- `validateWorkspaceEditPlan(plan)`

- [ ] **Step 3: Run model tests**

Run:

```bash
pnpm exec vitest run tests/frontend/code-action-model.test.ts tests/frontend/workspace-edit-model.test.ts
```

Expected:
- PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/code-actions tests/frontend/code-action-model.test.ts tests/frontend/workspace-edit-model.test.ts
git commit -m "feat: define code action edit models"
```

---

## Task 2: Extend Semantic Worker Protocol Without Applying Edits

**Files:**
- Modify: `semantic-worker/src/protocol.ts`
- Modify: `semantic-worker/src/session.ts`
- Create: `semantic-worker/src/features/code-actions.ts`
- Test: `semantic-worker/src/__tests__/code-actions.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Add tests for:
- `listCodeActions` returns at least template/generate actions for an ArkTS file;
- unsupported methods still return structured errors;
- action results contain no direct filesystem side effects.

Run:

```bash
pnpm --dir semantic-worker test -- code-actions
```

Expected:
- FAIL because `listCodeActions` is unsupported.

- [ ] **Step 2: Extend protocol**

Add request methods:
- `listCodeActions`
- `resolveCodeAction`
- `prepareRename`
- `rename`

Add payload types matching the shared model shape. Keep names camelCase because the worker speaks JSON to Rust and CLI.

- [ ] **Step 3: Implement deterministic action listing**

Initial worker behavior:
- For `.ets` files, return:
  - `Generate ArkTS Page`
  - `Generate ArkTS Component`
  - `Rename File`
- For unsupported file types, return an empty action list.

- [ ] **Step 4: Run semantic worker tests**

```bash
pnpm --dir semantic-worker test -- code-actions
```

Expected:
- PASS.

- [ ] **Step 5: Commit**

```bash
git add semantic-worker/src/protocol.ts semantic-worker/src/session.ts semantic-worker/src/features/code-actions.ts semantic-worker/src/__tests__/code-actions.test.ts
git commit -m "feat: add semantic code action protocol"
```

---

## Task 3: Add CLI Parser and Semantic Worker Client

**Files:**
- Create: `scripts/arkline-cli/cli-parser.mjs`
- Create: `scripts/arkline-cli/semantic-client.mjs`
- Create: `scripts/arkline-cli.mjs`
- Modify: `package.json`
- Test: `tests/frontend/arkline-cli.test.ts`

- [ ] **Step 1: Write failing CLI parser tests**

Cover:
- `arkline language inspect --json`
- `arkline language completion --workspace . --file src/main.ets --line 1 --column 1 --json`
- `arkline actions list --workspace . --file src/main.ets --line 1 --column 1 --json`
- edit-producing command defaults to dry run unless `--apply` is present.

Run:

```bash
pnpm exec vitest run tests/frontend/arkline-cli.test.ts
```

Expected:
- FAIL because parser file does not exist.

- [ ] **Step 2: Implement parser**

The parser returns structured command objects and never spawns processes. Invalid input returns `{ ok: false, error }`.

- [ ] **Step 3: Implement semantic client**

The client:
- starts `semantic-worker/dist/main.js`;
- writes JSON request lines;
- reads one JSON response per line;
- exposes `request(payload)` for CLI commands.

- [ ] **Step 4: Add top-level CLI**

Add executable behavior:

```bash
node scripts/arkline-cli.mjs actions list --workspace . --file src/main.ets --line 1 --column 1 --json
```

Output is JSON and exits non-zero on command or worker failure.

- [ ] **Step 5: Add package script**

Add:

```json
"cli": "node scripts/arkline-cli.mjs"
```

Do not publish a package `bin` yet unless distribution packaging requires it.

- [ ] **Step 6: Run CLI tests**

```bash
pnpm exec vitest run tests/frontend/arkline-cli.test.ts
```

Expected:
- PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/arkline-cli.mjs scripts/arkline-cli package.json tests/frontend/arkline-cli.test.ts
git commit -m "feat: add arkline cli action interface"
```

---

## Task 4: Add Rust Workspace Edit Runtime

**Files:**
- Create: `src-tauri/src/models/workspace_edit.rs`
- Create: `src-tauri/src/services/workspace_edit_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models/mod.rs` if present, otherwise register module in existing model structure.

- [ ] **Step 1: Write failing Rust tests**

Cover:
- text edit applies inside workspace root;
- text edit outside root is rejected;
- create file refuses overwrite unless `overwrite=true`;
- rename file refuses target collision unless `overwrite=true`;
- delete file refuses directories unless `recursive=true`;
- plan with conflicts does not apply.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_edit
```

Expected:
- FAIL because service does not exist.

- [ ] **Step 2: Implement DTOs**

Implement serde DTOs for:
- `WorkspaceEditPlan`
- `WorkspaceEditOperation`
- `TextRange`
- `EditConflict`
- `ApplyWorkspaceEditResult`

- [ ] **Step 3: Implement root-safe path validation**

Rules:
- normalize all paths;
- reject any operation whose path is outside workspace root;
- reject SDK paths and excluded dependency directories by default;
- return explicit conflict messages.

- [ ] **Step 4: Implement apply runtime**

Apply order:
1. validate all operations;
2. read all touched files;
3. apply text edits from bottom to top per file;
4. create/rename/delete files;
5. write changed files.

If validation fails, write nothing.

- [ ] **Step 5: Run Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_edit
```

Expected:
- PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models/workspace_edit.rs src-tauri/src/services/workspace_edit_service.rs src-tauri/src/lib.rs
git commit -m "feat: add workspace edit runtime"
```

---

## Task 5: Expose IDE Workspace Edit API

**Files:**
- Modify: `src/features/workspace/workspace-api.ts`
- Create: `src-tauri/src/commands/code_actions.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/frontend/language-service-api.test.ts`

- [ ] **Step 1: Write failing frontend API tests**

Verify `defaultWorkspaceApi` exposes:
- `listCodeActions`
- `resolveCodeAction`
- `previewWorkspaceEdit`
- `applyWorkspaceEdit`

Run:

```bash
pnpm exec vitest run tests/frontend/language-service-api.test.ts
```

Expected:
- FAIL because methods do not exist.

- [ ] **Step 2: Add workspace API types**

Add frontend request/response types and optional methods to `WorkspaceApi`.

- [ ] **Step 3: Add Tauri commands**

Commands:
- `list_code_actions`
- `resolve_code_action`
- `preview_workspace_edit`
- `apply_workspace_edit`

These should call semantic runtime for action discovery/resolve and workspace edit runtime for preview/apply.

- [ ] **Step 4: Run frontend API tests**

```bash
pnpm exec vitest run tests/frontend/language-service-api.test.ts
```

Expected:
- PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/workspace-api.ts src-tauri/src/commands/code_actions.rs src-tauri/src/lib.rs tests/frontend/language-service-api.test.ts
git commit -m "feat: expose code actions to workspace api"
```

---

## Task 6: Implement CLI Dry Run and Apply for Workspace Edits

**Files:**
- Modify: `scripts/arkline-cli.mjs`
- Modify: `scripts/arkline-cli/semantic-client.mjs`
- Create: `scripts/arkline-cli/workspace-edit-runtime.mjs`
- Test: `tests/frontend/arkline-cli.test.ts`

- [ ] **Step 1: Write failing CLI edit tests**

Cover:
- `generate page --dry-run --json` prints a `WorkspaceEditPlan`;
- `generate page --apply` writes the file inside workspace;
- `rename-file --dry-run` does not write;
- outside-root output path is rejected.

Run:

```bash
pnpm exec vitest run tests/frontend/arkline-cli.test.ts
```

Expected:
- FAIL because CLI edit runtime does not exist.

- [ ] **Step 2: Implement Node workspace edit runtime**

Mirror Rust validation rules for CLI:
- no writes outside workspace root;
- dry run by default;
- write only when `--apply` is present;
- print plan before applying when `--pretty` is used.

- [ ] **Step 3: Run CLI tests**

```bash
pnpm exec vitest run tests/frontend/arkline-cli.test.ts
```

Expected:
- PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/arkline-cli.mjs scripts/arkline-cli/workspace-edit-runtime.mjs tests/frontend/arkline-cli.test.ts
git commit -m "feat: support cli workspace edits"
```

---

## Task 7: Add IDE Code Actions Palette

**Files:**
- Create: `src/components/layout/CodeActionsPalette.tsx`
- Modify: `src/components/layout/shell-keymap.ts`
- Modify: `src/components/layout/app-shell-helpers.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`
- Test: `tests/frontend/shell-hotkeys.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Cover:
- `Alt+Enter` opens action palette at editor context;
- palette lists action title and kind;
- disabled action shows disabled reason;
- selecting safe action resolves edit;
- risky action opens preview instead of applying.

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx tests/frontend/shell-hotkeys.test.tsx --testNamePattern "code action|Alt\\+Enter|Refactor"
```

Expected:
- FAIL because UI does not exist.

- [ ] **Step 2: Add keybindings**

Add:
- `showCodeActions`: `Alt+Enter`
- `renameSymbol`: `F2`
- `generateCode`: `Alt+Insert`
- `refactorThis`: `Ctrl+Alt+Shift+T`

- [ ] **Step 3: Add palette component**

Use existing palette styling patterns. Keep keyboard behavior:
- Up/Down selects actions.
- Enter resolves selected action.
- Escape closes only the palette.
- Clicking outside closes.

- [ ] **Step 4: Wire AppShell orchestration**

`AppShell` should:
- call `workspaceApi.listCodeActions`;
- show loading/error/empty states;
- resolve selected action;
- open preview for plans requiring preview.

- [ ] **Step 5: Run UI tests**

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx tests/frontend/shell-hotkeys.test.tsx --testNamePattern "code action|Alt\\+Enter|Refactor"
```

Expected:
- PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/CodeActionsPalette.tsx src/components/layout/AppShell.tsx src/components/layout/shell-keymap.ts src/components/layout/app-shell-helpers.ts src/styles/app.css tests/frontend/app-shell.test.tsx tests/frontend/shell-hotkeys.test.tsx
git commit -m "feat: add ide code actions palette"
```

---

## Task 8: Add Workspace Edit Preview UI

**Files:**
- Create: `src/components/layout/WorkspaceEditPreview.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing preview tests**

Cover:
- preview shows affected file list;
- preview shows operation summary;
- Apply calls `workspaceApi.applyWorkspaceEdit`;
- Cancel closes without applying;
- conflicts disable Apply and show clear messages.

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "workspace edit preview|refactor preview"
```

Expected:
- FAIL because preview UI does not exist.

- [ ] **Step 2: Implement preview component**

Keep layout IDE-like:
- centered or tool-window style panel;
- left file list;
- right operation summary/diff placeholder;
- footer `Cancel / Apply`;
- applying state locks close.

- [ ] **Step 3: Wire preview apply**

On apply:
- block duplicate apply;
- call runtime;
- refresh changed/open files;
- close preview on success;
- show error inline on failure.

- [ ] **Step 4: Run preview tests**

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "workspace edit preview|refactor preview"
```

Expected:
- PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/WorkspaceEditPreview.tsx src/components/layout/AppShell.tsx src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: add workspace edit preview"
```

---

## Task 9: Implement Initial Shared Actions

**Files:**
- Modify: `semantic-worker/src/features/code-actions.ts`
- Modify: `semantic-worker/src/features/templates.ts`
- Test: `semantic-worker/src/__tests__/code-actions.test.ts`
- Test: `semantic-worker/src/__tests__/templates.test.ts`
- Test: `tests/frontend/arkline-cli.test.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Add failing end-to-end action tests**

Cover both IDE and CLI for:
- Generate ArkTS Page.
- Generate ArkTS Component.
- Rename File.

Expected behavior:
- CLI dry run prints edit plan.
- CLI apply writes/renames files.
- IDE resolves action and opens preview.
- Apply updates workspace file tree.

- [ ] **Step 2: Implement ArkTS templates**

Generate:
- `src/pages/<Name>.ets`
- `src/components/<Name>.ets`

Template output must be deterministic ASCII text and include:
- `@Entry` only for page template.
- `@Component`.
- `struct <Name>`.
- `build()`.

- [ ] **Step 3: Implement rename file action**

Action data:
- current file path;
- suggested new basename;
- target path;
- overwrite false.

The CLI command accepts `--to <path>`.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --dir semantic-worker test -- code-actions templates
pnpm exec vitest run tests/frontend/arkline-cli.test.ts tests/frontend/app-shell.test.tsx --testNamePattern "Generate ArkTS|Rename File"
```

Expected:
- PASS.

- [ ] **Step 5: Commit**

```bash
git add semantic-worker/src/features/code-actions.ts semantic-worker/src/features/templates.ts semantic-worker/src/__tests__/code-actions.test.ts semantic-worker/src/__tests__/templates.test.ts tests/frontend/arkline-cli.test.ts tests/frontend/app-shell.test.tsx
git commit -m "feat: add initial shared code actions"
```

---

## Task 10: Verification and Documentation

**Files:**
- Modify: `README.md` if present, otherwise create `docs/arkline-cli.md`
- Modify: `docs/superpowers/specs/README.md` only if the project maintains an index there.

- [ ] **Step 1: Add CLI usage docs**

Document:

```bash
pnpm cli language inspect --json
pnpm cli actions list --workspace /path/to/project --file src/pages/Index.ets --line 1 --column 1 --json
pnpm cli generate page --workspace /path/to/project --name Home --dry-run --json
pnpm cli generate page --workspace /path/to/project --name Home --apply
pnpm cli rename-file --workspace /path/to/project --file src/pages/Old.ets --to src/pages/New.ets --dry-run --json
```

- [ ] **Step 2: Run full verification**

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:
- PASS.

- [ ] **Step 3: Run CLI smoke**

```bash
pnpm build:semantic-worker
pnpm cli language inspect --json
```

Expected:
- JSON response with `ok: true` or equivalent structured success.

- [ ] **Step 4: Commit docs and verification updates**

```bash
git add README.md docs/arkline-cli.md docs/superpowers/specs/README.md
git commit -m "docs: document arkline cli code actions"
```

---

## Acceptance Criteria

- IDE and CLI use the same action/edit contracts.
- CLI can list actions and produce dry-run edit plans.
- CLI can apply safe file-generation and rename-file edits inside a workspace root.
- IDE can open `Alt+Enter` action palette.
- IDE can preview workspace edits before applying.
- Rust/Tauri runtime rejects outside-root file operations.
- Initial action set works in both IDE and CLI:
  - Generate ArkTS Page.
  - Generate ArkTS Component.
  - Rename File.
- Existing navigation, completion, terminal, Git, settings, and build flows remain passing.

## Risks and Mitigations

- **Risk:** IDE and CLI edit runtimes drift.
  - **Mitigation:** Keep shared JSON contract tests and fixture edit plans.

- **Risk:** Node CLI and Rust Tauri apply behavior diverge.
  - **Mitigation:** Use the same fixture operations in JS and Rust tests.

- **Risk:** Rename Symbol is attempted before references are reliable.
  - **Mitigation:** Start with Rename File, then add Rename Symbol only after `prepareRename` and references are stable.

- **Risk:** AppShell grows further.
  - **Mitigation:** Keep new UI in `CodeActionsPalette.tsx` and `WorkspaceEditPreview.tsx`; AppShell only orchestrates.

- **Risk:** Unsafe workspace writes.
  - **Mitigation:** Dry-run by default in CLI; preview by default in IDE; root-safe path validation in both runtimes.

## Self-Review

- Spec coverage: The plan covers shared contracts, CLI preservation, IDE integration, edit runtime, templates, and initial low-risk actions.
- Placeholder scan: No `TBD` or deferred unnamed steps remain.
- Type consistency: `CodeAction`, `WorkspaceEditPlan`, and `WorkspaceEditOperation` are used consistently across tasks.
- Scope check: Extract Method, Rename Symbol, and advanced refactors are intentionally deferred until the platform is stable.
