# ArkLine MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Windows x64 executable for a lightweight ArkTS IDE with IDEA-inspired navigation, traditional editing assistance, fast search, lint/format feedback, Git diff review, and an independently replaceable ArkTS language-service process.

**Architecture:** ArkLine is a Tauri v2 desktop application with a Rust backend and a web frontend. The frontend owns presentation, editor rendering, and keyboard workflows; the Rust backend owns filesystem access, ripgrep, Git, lint/format command execution, and standard LSP over stdio. The application stays usable when optional tools or the language server are missing.

**Tech Stack:** Rust, Tauri v2, React, TypeScript, Vite, CodeMirror 6, Vitest, `rg.exe`, `git.exe`, JSON/JSONC configuration, standard LSP over stdio, `@arkts/language-server` as the initial pinned provider, Tauri Windows bundler with NSIS, GitHub Actions `windows-latest`.

---

## 1. Product Definition

ArkLine is a Windows-only ArkTS editor and review cockpit. It keeps local files and
Git as the source of truth. It does not attempt to replace DevEco Studio's build,
preview, emulator, device, test, or debugging workflows.

The only explicit validation workflows in MVP are lint and format. Syntax and
semantic diagnostics delivered by the language service are editor feedback, not
a build or test pipeline.

Additional constraints confirmed after the initial plan:

- ArkTS SDK dependencies must be isolated behind Rust infrastructure boundaries
  and must not leak into frontend feature code.
- Code reading quality is a first-class product requirement: typography, line
  spacing, contrast, and navigation ergonomics are part of MVP quality.
- No production source file should exceed 500 lines. Split files before they
  become large multi-responsibility units.
- Windows packaging must account for WebView2 availability.

Primary users:

- ArkTS developers who want faster startup, navigation, search, and review.
- Developers who use external coding agents and want a focused diff-review surface.
- Teams that need a small local executable without accounts or cloud workspaces.

Primary user journey:

```text
Launch ArkLine
  -> open local HarmonyOS project
  -> Quick Open or search for ArkTS code
  -> edit with completion/navigation
  -> save and receive format/lint feedback
  -> review Git or agent-generated changes in Diff
```

## 2. MVP Boundaries

### Included

- Windows x64 portable package and NSIS installer.
- IDEA-inspired shell with Files, Search, Editor, Problems, and Diff surfaces.
- Quick Open, command palette, configurable shortcuts, recent projects/files.
- `.ets`, `.ts`, and `.json5` editing.
- Syntax highlighting, completion, hover, definition, references, symbols, rename.
- Fast full-text search through bundled ripgrep.
- ArkTS-oriented query presets for decorators, components, resources, and changes.
- Configurable lint and format commands with format-on-save.
- Git status, changed files, diff rendering, file revert with confirmation.
- Import and review of unified diff patches from external agents.
- Graceful degraded mode without optional external tools.

### Excluded

- Build, test, debug, preview, emulator, device, and CI features.
- Embedded AI chat or autonomous agent execution.
- Visual UI designer.
- Cloud accounts, synchronization, or workspaces.
- Plugin marketplace.
- Self-authored ArkTS compiler or language server.
- Persistent full-code AST database.
- Automatic application update.

## 3. Non-Functional Requirements

### Performance targets

| Metric | MVP target |
|---|---:|
| Cold start to editable window | <= 2.5 seconds |
| Idle memory without LSP | target <= 160 MB |
| Total memory with LSP | target <= 340 MB |
| Quick Open update | <= 50 ms |
| Search first result | <= 300 ms on warm cache |
| UI stalls from external tools | none perceptible |

### Reliability requirements

- A tool failure cannot crash the editor.
- Search, LSP, lint, format, and Git operations are cancellable.
- Unsaved buffers survive tool restarts and workspace refreshes.
- ArkTS language-server failure triggers at most one automatic restart.
- Destructive Git operations require explicit confirmation.
- Configuration errors identify the file and field involved.

### Maintainability requirements

- No production file exceeds 500 lines.
- Modules, hooks, stores, and services stay focused on one clear responsibility.
- Provider-specific SDK handling remains confined to Rust services.
- Large React views must be decomposed into reusable components before they
  become difficult to review.

### Distribution requirements

- Produce `ArkLine.exe` in a portable Windows x64 folder.
- Produce `ArkLine-Setup.exe` through Tauri's NSIS bundling target.
- Bundle `rg.exe` and the selected language-server runtime only after license review.
- Do not bundle Huawei SDK/HMS SDK content.
- Detect Git and SDK locations, with manual override in settings.
- Enforce a minimum WebView2 version through Windows bundle configuration.

## 4. Target Repository Layout

```text
package.json
pnpm-lock.yaml
tsconfig.json
vite.config.ts
vitest.config.ts
Agent.md
README.md
gitlog.md

src/
  app/
  components/
  editor/
  features/
  state/
  styles/
  types/

src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json
  capabilities/
  src/
    main.rs
    lib.rs
    commands/
    models/
    processes/
    services/
    state/

tests/
  frontend/
  fixtures/
    SampleArkTsProject/

scripts/
  package-windows.ps1

docs/
  mvp-implementation-plan.md
  mvp-execution-plan.md
  architecture.md
  performance-baseline.md
  third-party-notices.md

.github/workflows/
  windows-ci.yml
```

## 5. Dependency Decisions

| Area | Choice | Reason |
|---|---|---|
| Desktop shell | Tauri v2 | Smaller Windows app host than Electron while keeping web UI flexibility |
| Frontend | React + TypeScript + Vite | Mainstream web stack with strong hiring and ecosystem fit |
| Editor | CodeMirror 6 | Modular extension model with lighter footprint than Monaco and strong customizability |
| Layout | native web layout with virtualized panes | IDEA-style density without a separate docking dependency |
| Full-text search | ripgrep | Fast, streaming, Git-ignore aware |
| File search | compact in-memory path list | Very low-latency Quick Open |
| Semantic search | LSP workspace symbols | Avoid a separate AST index in MVP |
| ArkTS intelligence | replaceable stdio LSP adapter | Keeps provider changes outside frontend and UI workflows |
| Initial provider | pinned `@arkts/language-server` | Current practical independent ArkTS server |
| Git | `git.exe` CLI through Rust | Reliable behavior and small implementation surface |
| Frontend tests | Vitest | Fast TypeScript unit test loop |
| Backend tests | cargo test | Native Rust test workflow |
| Installer | Tauri NSIS bundle | Produces Windows installer EXE and handles WebView2 requirements |

Do not introduce SQLite, Lucene, Electron, or a native Git library in MVP unless
benchmark evidence shows the selected approach cannot satisfy requirements.

## 6. Implementation Tasks

### Task 1: Bootstrap the Tauri workspace

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `README.md`
- Create: `gitlog.md`

- [x] **Step 1: Initialize the frontend workspace with React, TypeScript, Vite, and a pinned package manager lockfile.**
- [x] **Step 2: Initialize the Tauri v2 Rust host under `src-tauri/` with a minimal compileable app entry.**
- [x] **Step 3: Configure strict TypeScript, frontend path aliases, and consistent lint-free build settings.**
- [x] **Step 4: Configure Rust package metadata, Windows target defaults, and deterministic release settings where applicable.**
- [x] **Step 5: Add a smoke frontend test and a smoke Rust test asserting both test layers load.**
- [x] **Step 6: Run `pnpm test` and expect the smoke frontend tests to pass.**
- [x] **Step 7: Run `cargo test --manifest-path src-tauri/Cargo.toml` and expect the smoke Rust tests to pass.**
- [ ] **Step 8: Commit with `chore: bootstrap ArkLine Tauri workspace`.**

### Task 2: Build the IDEA-inspired application shell

**Files:**

- Create: `src/app/App.tsx`
- Create: `src/app/routes.ts`
- Create: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/ToolWindow.tsx`
- Create: `src/features/workspace/MainWorkspaceView.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Write tests for layout state, tool-window visibility, and keyboard-driven pane toggling.**
- [x] **Step 2: Create a dense shell with left Files/Search tool windows, central editor tabs, bottom Problems/Diff surfaces, and compact status bar.**
- [x] **Step 3: Add collapsible tool-window behavior without drag docking.**
- [x] **Step 4: Add IDEA-inspired colors and typography using centralized CSS tokens for color, spacing, and font defaults.**
- [x] **Step 5: Set readable editor-adjacent defaults for programming font, line spacing, contrast, caret visibility, and dense-but-comfortable tab/status text.**
- [x] **Step 6: Add empty states that identify the next concrete action without marketing copy.**
- [ ] **Step 7: Run frontend tests and verify resizing logic for 1280x720 and 1920x1080 layouts.**
- [ ] **Step 8: Commit with `feat: add ArkLine desktop shell`.**

### Task 3: Implement workspace and document management

**Files:**

- Create: `src/features/workspace/workspace-store.ts`
- Create: `src/features/workspace/file-tree-store.ts`
- Create: `src/features/documents/document-store.ts`
- Create: `src/features/documents/editor-tabs-store.ts`
- Create: `src-tauri/src/commands/workspace.rs`
- Create: `src-tauri/src/services/workspace_service.rs`
- Test: `tests/frontend/workspace-store.test.ts`
- Test: `src-tauri/src/services/workspace_service.rs`

- [x] **Step 1: Write tests for opening a temporary workspace, normalizing Windows paths, applying default excludes, and detecting file changes.**
- [x] **Step 2: Define serializable workspace and file descriptors shared through command contracts.**
- [ ] **Step 3: Implement asynchronous directory discovery with `.git`, `.hvigor`, `build`, and `node_modules` excluded by default.**
- [ ] **Step 4: Implement file watching with event coalescing and cancellation.**
- [ ] **Step 5: Add editor tabs, dirty-state tracking, save, save-as, close confirmation, and recent-file history.**
- [ ] **Step 6: Persist recent projects and files in the Tauri app data directory.**
- [ ] **Step 7: Make long filenames, deep paths, and large directory trees readable through truncation rules, tooltips, and predictable selection behavior.**
- [ ] **Step 8: Run tests and manually verify that unsaved buffers survive external file refresh prompts.**
- [ ] **Step 9: Commit with `feat: add workspace and document management`.**

### Task 4: Integrate CodeMirror and baseline ArkTS editing

**Files:**

- Create: `src/editor/ArkTsEditor.tsx`
- Create: `src/editor/editor-extensions.ts`
- Create: `src/editor/theme.ts`
- Create: `src/editor/editor-events.ts`
- Create: `src/types/editor.ts`
- Test: `tests/frontend/editor.test.tsx`

- [ ] **Step 1: Add pinned CodeMirror 6 packages and only the extensions needed for MVP.**
- [ ] **Step 2: Write document-state tests for edits, dirty state, save snapshots, and external changes.**
- [ ] **Step 3: Implement `.ets`, `.ts`, and `.json5` syntax highlighting and language wiring.**
- [ ] **Step 4: Add line numbers, bracket matching, folding hooks, selection, undo/redo, and find/replace.**
- [ ] **Step 5: Add readable editor defaults for font family, font size, line height, letterform clarity, visible whitespace policy, current-line highlight, and column guide behavior.**
- [ ] **Step 6: Bind diagnostics and navigation markers through editor extension layers rather than direct component code.**
- [ ] **Step 7: Verify a 10 MB source file remains editable and does not block the UI while opening.**
- [ ] **Step 8: Commit with `feat: add ArkTS editor foundation`.**

### Task 5: Add command palette, shortcuts, and Quick Open

**Files:**

- Create: `src/features/commands/command-registry.ts`
- Create: `src/features/commands/command-palette-store.ts`
- Create: `src/features/search/fuzzy-matcher.ts`
- Create: `src/components/commands/CommandPalette.tsx`
- Create: `src-tauri/src/commands/settings.rs`
- Create: `src-tauri/src/services/keybinding_store.rs`
- Test: `tests/frontend/fuzzy-matcher.test.ts`
- Test: `src-tauri/src/services/keybinding_store.rs`

- [ ] **Step 1: Write tests for ranked fuzzy matching, path-segment scoring, cancellation, and empty queries.**
- [ ] **Step 2: Implement the command registry and Quick Open matching without blocking the UI thread.**
- [ ] **Step 3: Register default shortcuts for Quick Open, command palette, search, definition, references, rename, format, Problems, and Diff.**
- [ ] **Step 4: Load user overrides from `keybindings.json`, reporting conflicts in Problems.**
- [ ] **Step 5: Add virtualized command and file result lists with keyboard-only selection.**
- [ ] **Step 6: Benchmark Quick Open against 100,000 synthetic paths and record results in `docs/performance-baseline.md`.**
- [ ] **Step 7: Commit with `feat: add command palette and quick open`.**

### Task 6: Implement fast workspace search

**Files:**

- Create: `src/features/search/search-store.ts`
- Create: `src/components/search/SearchPanel.tsx`
- Create: `src-tauri/src/commands/search.rs`
- Create: `src-tauri/src/processes/process_runner.rs`
- Create: `src-tauri/src/services/ripgrep_search_service.rs`
- Test: `tests/frontend/search-store.test.ts`
- Test: `src-tauri/src/services/ripgrep_search_service.rs`

- [ ] **Step 1: Write tests using a fake process runner for argument escaping, regex, case options, include/exclude globs, streaming output, cancellation, and malformed lines.**
- [ ] **Step 2: Implement a shared cancellable Rust process runner with separated stdout/stderr and bounded output.**
- [ ] **Step 3: Implement ripgrep JSON-output parsing and stream typed search results to the frontend.**
- [ ] **Step 4: Add ArkTS query presets for `@Entry`, `@Component`, state decorators, `$r(...)`, event handlers, and changed files.**
- [ ] **Step 5: Add virtualized grouped results and keyboard navigation to the Search tool window.**
- [ ] **Step 6: Bundle a pinned Windows x64 `rg.exe` and document its license in `docs/third-party-notices.md`.**
- [ ] **Step 7: Benchmark first-result latency on small and large sample projects.**
- [ ] **Step 8: Commit with `feat: add ripgrep workspace search`.**

### Task 7: Add the replaceable ArkTS language-service adapter

**Files:**

- Create: `src/features/language/language-client.ts`
- Create: `src/features/language/language-types.ts`
- Create: `src-tauri/src/commands/language.rs`
- Create: `src-tauri/src/services/lsp_json_rpc.rs`
- Create: `src-tauri/src/services/arkts_language_server.rs`
- Create: `src-tauri/src/services/language_server_supervisor.rs`
- Create: `src-tauri/src/services/noop_language_service.rs`
- Test: `tests/frontend/language-client.test.ts`
- Test: `src-tauri/src/services/lsp_json_rpc.rs`
- Test: `src-tauri/src/services/language_server_supervisor.rs`

- [ ] **Step 1: Write protocol tests for LSP framing, request/response correlation, notifications, cancellation, timeout, malformed messages, and server exit.**
- [ ] **Step 2: Define provider-neutral completion, hover, location, reference, symbol, rename, and diagnostic models.**
- [ ] **Step 3: Implement JSON-RPC/LSP stdio transport without leaking provider-specific types into frontend contracts.**
- [ ] **Step 4: Implement lazy startup, one process per workspace, one automatic restart, and graceful shutdown.**
- [ ] **Step 5: Keep SDK and provider discovery isolated in Rust services so frontend and editor code never depend on SDK installation details.**
- [ ] **Step 6: Integrate completion, hover, definition, references, workspace symbols, rename preview, and diagnostics into CodeMirror extensions and frontend flows.**
- [ ] **Step 7: Implement degraded mode using a no-op language service; editing and ripgrep search must remain available.**
- [ ] **Step 8: Pin and package a known working `@arkts/language-server` distribution plus Node runtime only after license review.**
- [ ] **Step 9: Test on Windows against API-level sample projects and record startup, completion latency, and memory in `docs/performance-baseline.md`.**
- [ ] **Step 10: Commit with `feat: integrate ArkTS language service`.**

### Task 8: Implement lint, format, and Problems

**Files:**

- Create: `src/features/problems/problems-store.ts`
- Create: `src/components/problems/ProblemsPanel.tsx`
- Create: `src-tauri/src/commands/diagnostics.rs`
- Create: `src-tauri/src/services/lint_service.rs`
- Create: `src-tauri/src/services/format_service.rs`
- Test: `tests/frontend/problems-store.test.ts`
- Test: `src-tauri/src/services/lint_service.rs`
- Test: `src-tauri/src/services/format_service.rs`

- [ ] **Step 1: Write tests for configurable command templates, Windows argument quoting, cancellation, timeout, missing executable, nonzero exit, and diagnostic parsing.**
- [ ] **Step 2: Implement workspace settings for lint command, format command, format-on-save, and timeout.**
- [ ] **Step 3: Implement document and workspace lint execution with deduplicated typed diagnostics.**
- [ ] **Step 4: Implement format document and format selection while preserving caret and undo history.**
- [ ] **Step 5: Build a Problems view containing only lint, format, language-service, configuration, and tool-availability diagnostics.**
- [ ] **Step 6: Verify missing lint/format commands do not prevent editing or saving.**
- [ ] **Step 7: Commit with `feat: add lint format and problems`.**

### Task 9: Implement Git diff and patch review

**Files:**

- Create: `src/features/diff/diff-store.ts`
- Create: `src/components/diff/DiffPanel.tsx`
- Create: `src-tauri/src/commands/git.rs`
- Create: `src-tauri/src/services/git_service.rs`
- Create: `src-tauri/src/services/unified_diff_parser.rs`
- Test: `tests/frontend/diff-store.test.ts`
- Test: `src-tauri/src/services/unified_diff_parser.rs`
- Test: `src-tauri/src/services/git_service.rs`

- [ ] **Step 1: Write parser tests for added, modified, deleted, renamed, binary, whitespace-only, and malformed patches.**
- [ ] **Step 2: Write Git adapter tests in temporary repositories for status, diff, file revert, and patch apply checks.**
- [ ] **Step 3: Implement changed-file discovery and unified diff parsing through the shared process runner.**
- [ ] **Step 4: Build inline and side-by-side diff review with next/previous change navigation.**
- [ ] **Step 5: Add file revert and patch apply with explicit confirmation and preflight checks.**
- [ ] **Step 6: Import external agent patches without embedding an agent runtime.**
- [ ] **Step 7: Verify unsaved buffers are never silently overwritten by Git or patch operations.**
- [ ] **Step 8: Commit with `feat: add git and patch review`.**

### Task 10: Add environment diagnostics and settings

**Files:**

- Create: `src/features/settings/settings-store.ts`
- Create: `src/components/settings/SettingsDialog.tsx`
- Create: `src-tauri/src/commands/environment.rs`
- Create: `src-tauri/src/services/settings_store.rs`
- Create: `src-tauri/src/services/environment_doctor.rs`
- Test: `tests/frontend/settings-store.test.ts`
- Test: `src-tauri/src/services/settings_store.rs`
- Test: `src-tauri/src/services/environment_doctor.rs`

- [ ] **Step 1: Write tests for defaults, malformed JSON, atomic writes, migration, missing tools, SDK discovery, and WebView2-related bundle assumptions where configuration applies.**
- [ ] **Step 2: Store settings atomically in the Tauri app data directory.**
- [ ] **Step 3: Detect Git, bundled ripgrep, language server, lint/format commands, configured HarmonyOS/OpenHarmony SDK paths, and relevant Windows runtime assumptions without hard-wiring SDK assumptions into frontend layers.**
- [ ] **Step 4: Display actionable status without blocking the main editor window.**
- [ ] **Step 5: Add log files with rotation and no source-code content by default.**
- [ ] **Step 6: Commit with `feat: add settings and environment doctor`.**

### Task 11: Package Windows executables

**Files:**

- Create: `scripts/package-windows.ps1`
- Update: `src-tauri/tauri.conf.json`
- Create: `.github/workflows/windows-ci.yml`
- Update: `README.md`
- Update: `docs/third-party-notices.md`

- [ ] **Step 1: Add Windows CI for frontend install, frontend tests, Rust tests, and Tauri build.**
- [ ] **Step 2: Configure `tauri.conf.json` for Windows x64 packaging, NSIS output, app metadata, and minimum WebView2 version.**
- [ ] **Step 3: Copy bundled tools and language-server assets into the Tauri app resources layout.**
- [ ] **Step 4: Generate a portable Windows artifact plus `ArkLine-Setup.exe`.**
- [ ] **Step 5: Verify installer settings for Start Menu entry, uninstall support, and no shell-profile edits.**
- [ ] **Step 6: Install on a clean Windows test machine and verify launch without a preinstalled app runtime other than WebView2 handling enforced by the installer.**
- [ ] **Step 7: Open the sample ArkTS project and verify Quick Open, search, editing, lint/format, language features, and Git diff.**
- [ ] **Step 8: Commit with `build: package ArkLine for Windows`.**

### Task 12: Verify performance and release readiness

**Files:**

- Create: `scripts/measure-performance.ps1`
- Update: `docs/performance-baseline.md`
- Update: `README.md`

- [ ] **Step 1: Add reproducible Quick Open and search benchmark fixtures.**
- [ ] **Step 2: Measure cold start, idle memory, LSP memory, Quick Open, and search first-result latency on Windows.**
- [ ] **Step 3: Profile any missed target before changing architecture.**
- [ ] **Step 4: Run frontend tests, Rust tests, portable launch, installer launch, and uninstall verification.**
- [ ] **Step 5: Confirm all MVP exclusions remain excluded.**
- [ ] **Step 6: Record known limitations, WebView2 behavior, and exact dependency versions in README and third-party notices.**
- [ ] **Step 7: Commit with `release: prepare ArkLine MVP`.**

## 7. Acceptance Checklist

- [ ] `ArkLine.exe` launches on a clean Windows 11 x64 system.
- [ ] A local ArkTS project opens without modifying project files.
- [ ] File tree, Quick Open, workspace search, and editor tabs work by keyboard.
- [ ] Editor typography and spacing are comfortable for sustained code reading on Windows at common DPI scales.
- [ ] `.ets` editing remains available when the language server is unavailable.
- [ ] Completion, hover, definition, references, symbols, and rename work when LSP is healthy.
- [ ] Lint and format commands are configurable and failures appear in Problems.
- [ ] Git changes and imported patches are reviewable without silent file loss.
- [ ] No shipped production source file exceeds 500 lines.
- [ ] Core idle and LSP memory measurements are recorded and evaluated against targets.
- [ ] Portable zip and installer EXE are generated by Windows CI.
- [ ] Third-party licenses are documented; Huawei SDK/HMS SDK files are not redistributed.
- [ ] Windows bundle configuration accounts for WebView2 requirements.

## 8. Execution Order

Implement tasks sequentially. Tasks 1-6 produce a useful lightweight editor without
ArkTS semantic services. Task 7 adds language intelligence behind a replaceable
boundary. Tasks 8-10 complete the MVP workflows. Tasks 11-12 make the result a
verifiable Windows product rather than a development demo.

Do not start later tasks by introducing temporary architecture that contradicts
the dependency boundaries in `Agent.md`.
