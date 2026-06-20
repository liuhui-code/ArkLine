# ArkLine Agent Instructions

## Project Mission

Build ArkLine, a lightweight Windows-only ArkTS IDE focused on fast navigation,
traditional editing assistance, lint/format feedback, and review of changes made
by humans or external coding agents.

ArkLine is not intended to replace the full HarmonyOS toolchain. It is a fast,
local-first editor and review surface that works with existing projects and
external tools.

## Required Reading

Before implementation work:

1. Read this file completely.
2. Read `docs/mvp-implementation-plan.md`.
3. Read `docs/mvp-execution-plan.md`.
4. Check the current Git status and preserve unrelated user changes.
5. Identify the exact plan task being implemented before editing files.

## Confirmed Product Decisions

- Product name: ArkLine.
- Target platform: Windows x64 only for MVP.
- UI direction: dense, keyboard-driven, IDEA-inspired desktop layout.
- Desktop framework: Tauri v2 with a Rust backend and a web frontend.
- Frontend stack: React, TypeScript, and Vite.
- Editor component: CodeMirror 6. Do not introduce Monaco or Electron without
  an approved architecture change.
- Workspace truth: the user's local filesystem and Git repository.
- Search: bundled `rg.exe` for full-text search; compact in-memory file lists for
  Quick Open; language-server workspace symbols for semantic search.
- Language intelligence: standard LSP over stdio through a replaceable Rust
  adapter and supervisor.
- Initial ArkTS server candidate: pinned `@arkts/language-server`, started lazily
  as one child process per open workspace.
- ArkTS SDK boundary: any HarmonyOS/OpenHarmony SDK dependency must stay outside
  the frontend code. SDK discovery, path resolution, version checks, and
  provider-specific launching belong only in isolated Rust services.
- Formal validation workflows in MVP: lint and format only. Syntax and semantic
  diagnostics remain part of traditional editing assistance, not a separate
  build/test validation pipeline.
- Distribution: portable Windows x64 package and NSIS installer producing
  `ArkLine.exe` / `ArkLine-Setup.exe`.
- Windows runtime assumption: WebView2 is used on Windows. Windows 11 typically
  has it preinstalled; the installer must enforce or bootstrap the minimum
  required version.

## MVP Scope

Build:

- Open a local ArkTS/HarmonyOS project directory.
- File tree, recent projects, editor tabs, Problems, Search, and Diff views.
- Quick Open, command palette, configurable keyboard shortcuts, and recent files.
- `.ets`, `.ts`, and `.json5` editing with syntax highlighting.
- Completion, hover, definition, references, workspace symbols, and rename through
  the language-service adapter when available.
- Graceful fallback editing and search when the language server is unavailable.
- Full-text search with regex, case, glob include, and glob exclude controls.
- ArkTS-focused queries for decorators, components, resources, and changed files.
- Configurable lint and format commands; format-on-save; Problems integration.
- Git changed-file list and side-by-side or inline diff review.
- Import and review of unified diff patches produced by external agents.
- Windows x64 executable packaging and environment diagnostics.

Do not build in MVP:

- Project build orchestration.
- Test runner or test explorer.
- Debugger.
- ArkUI previewer.
- Emulator or physical-device management.
- CI dashboards.
- Embedded AI chat.
- Embedded autonomous agent runtime.
- Visual drag-and-drop UI designer.
- Cloud workspace or account system.
- Extension marketplace.
- A new ArkTS compiler or language server.

## Architecture

Use one frontend application, one Rust host, and two test layers:

```text
src/
  app/                    React composition root and layout shell
  components/             shared UI building blocks
  features/               workspace, search, diff, problems, settings
  editor/                 CodeMirror integration and editor-only concerns
  state/                  client state and command wiring
  styles/                 design tokens, typography, and layout rules
src-tauri/
  src/
    main.rs               Tauri entry point
    lib.rs                app bootstrap and command registration
    commands/             Tauri invoke handlers
    models/               serializable request/response models
    services/             filesystem, rg, Git, lint/format, LSP, SDK, settings
    processes/            child-process runner and supervision
    state/                backend shared state and supervisors
tests/
  frontend/               Vitest component and state tests
  backend/                cargo test modules under src-tauri/src
```

Keep the dependency direction strict:

```text
React UI -> Tauri invoke/event API -> Rust backend services
Rust backend -> local filesystem / rg / git / node / ArkTS LSP
Frontend -> no direct filesystem, shell, or SDK access
```

The frontend must consume typed command contracts; it must not run shell commands,
parse Git output, or speak LSP directly.

## SDK Isolation Boundary

Treat ArkTS SDK integration as optional environment infrastructure, not as an
application dependency.

Required rules:

- Frontend TypeScript code must not reference HarmonyOS, OpenHarmony, DevEco,
  Node, or provider-specific SDK packages.
- SDK state must be rendered through command results and view state only.
- SDK lookup, environment probing, and process launch arguments belong in
  `src-tauri/src/services`.
- The editor must open, browse, search, and edit source code even when no SDK is
  installed.
- Any future provider swap must be possible by replacing Rust services without
  changing editor workflows.

## Language-Service Boundary

Treat ArkTS language support as replaceable backend infrastructure. The frontend
must depend on typed commands and events, not on a specific package or process.

Required adapter behavior:

- Start lazily after the first ArkTS document opens.
- Use one server process per workspace.
- Communicate through standard LSP over stdio.
- Apply request timeouts and cancellation.
- Restart at most once after an unexpected crash, then expose degraded mode.
- Stop the process when the workspace closes.
- Never block text editing while the server starts or recovers.

Do not redistribute HarmonyOS/HMS SDK files without explicit license review.
Discover an existing SDK or let the user configure its path.

## Performance Budgets

Treat these as MVP acceptance targets measured on a representative Windows 11 x64
machine and real ArkTS projects:

- Cold start to editable window: target at most 2.5 seconds.
- Idle private working set without language server: target at most 160 MB.
- Total private working set with language server: target at most 340 MB.
- Quick Open result update: at most 50 ms after input settles.
- Workspace search first result: at most 300 ms for a warm filesystem cache.
- Editor keystroke handling: no visible blocking on filesystem, Git, search, lint,
  format, or LSP operations.
- Search results must stream and virtualize; never materialize unbounded result sets.

When a target is missed, profile before optimizing. Record the measurement,
project size, machine, and bottleneck.

## UX Rules

- Keep the interface dense, restrained, and work-focused.
- Use an IDEA-inspired structure: left tool windows, editor tabs in the center,
  bottom Problems/Diff surfaces, and a compact status bar.
- Optimize code reading comfort deliberately: ship or select a highly legible
  programming font with clear `0/O`, `1/I/l`, and punctuation distinction; use
  comfortable default line spacing; avoid visually cramped glyph rendering.
- Make editor typography configurable per user for font family, size, line
  height, ligatures, and minimap visibility, with readable defaults rather than
  aggressive information density.
- Keyboard workflows are first-class. Every frequent command must be discoverable
  in the command palette and assignable in `keybindings.json`.
- Do not make chat the primary interaction.
- Do not hide file changes behind summaries. Git diff is the review truth.
- Always preserve unsaved buffers and ask before destructive file operations.
- A missing SDK, Git executable, linter, formatter, or language server must degrade
  the related feature instead of preventing the editor from opening.

## Search Rules

- Use the bundled ripgrep executable for full-text search.
- Stream stdout asynchronously and support cancellation.
- Respect `.gitignore` by default.
- Exclude `.git`, `.hvigor`, `build`, `node_modules`, and generated output unless
  the user explicitly includes them.
- Keep filename search in a compact normalized path list.
- Do not add SQLite, Lucene, or a persistent AST database until benchmarks prove
  that ripgrep plus LSP workspace symbols are insufficient.

## Coding Rules

- Frontend TypeScript must run in strict mode.
- Backend Rust code must prefer explicit error types over stringly typed failure.
- Use cancellation or abort signals for search, LSP, lint, format, and Git operations.
- Keep main-thread UI work bounded and deterministic.
- Prefer small focused modules with explicit interfaces over global service locators.
- Keep source files and modules small enough to review comfortably. No production
  file should exceed 500 lines. Split files earlier when they approach roughly
  400 lines or accumulate multiple responsibilities.
- Use structured request and response models instead of parsing UI strings.
- Keep external process invocation behind a shared Rust process-runner abstraction.
- Validate and normalize Windows paths at subsystem boundaries.
- Avoid speculative abstractions and features outside the current plan task.
- Add comments only where behavior or protocol constraints are not self-evident.

## Testing Rules

- Use Vitest for frontend unit tests.
- Use `cargo test` for backend unit and integration tests.
- Develop behavior test-first where practical.
- Use temporary directories for filesystem and Git integration tests.
- Test cancellation, timeout, malformed output, missing executable, and process
  crash paths for every external tool adapter.
- Keep UI logic in testable hooks, stores, or controller modules; reserve browser
  or desktop automation for a small set of critical keyboard and workspace flows.
- Run performance smoke tests on Windows before claiming memory or latency targets.

## Verification Commands

The implementation plan will establish the exact files. The expected top-level
verification commands are:

```powershell
pnpm install
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
pnpm tauri build
```

Packaging verification must launch the generated `ArkLine.exe` on Windows, open a
sample ArkTS project, run Quick Open and workspace search, show lint/format output,
and display a Git diff.

## Change Discipline

- Keep each commit aligned with one implementation-plan task.
- Do not rewrite unrelated files or user changes.
- Update `docs/mvp-implementation-plan.md` checkboxes as tasks are completed.
- Add a concise entry to `gitlog.md` after meaningful local changes once that file
  exists.
- Architecture changes require updating this document and the implementation plan
  before implementation continues.
