# ArkLine MVP Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first usable Windows x64 build of ArkLine as a lightweight ArkTS IDE centered on editing, navigation, lint/format validation, and Git or patch review.

**Architecture:** Execute the MVP in four waves: foundation, usable editor, ArkTS intelligence, and Windows packaging. Keep the web frontend free of SDK and host-process logic, keep SDK handling isolated in Rust services, and keep the product usable even when the ArkTS language server or SDK is unavailable.

**Tech Stack:** Tauri v2, Rust, React, TypeScript, Vite, CodeMirror 6, Vitest, ripgrep, Git CLI, stdio LSP, `@arkts/language-server`, NSIS bundling on `windows-latest`.

---

## 1. Execution Strategy

This document is the practical build order for the existing MVP plan in
`docs/mvp-implementation-plan.md`.

Use it this way:

- `mvp-implementation-plan.md` is the detailed engineering task book.
- `mvp-execution-plan.md` is the delivery roadmap and checkpoint list.
- `Agent.md` is the architectural guardrail.

The execution rule is simple:

1. Build a thin but shippable editor core first.
2. Add ArkTS intelligence only after the fallback editing path is stable.
3. Add packaging only after the desktop workflows are proven locally.
4. Treat performance, SDK isolation, readability, and WebView2 handling as
   acceptance gates, not polish.

## 2. MVP Completion Definition

The MVP is complete only when all of these are true:

- `ArkLine.exe` launches on Windows 11 x64 without extra manual runtime setup
  beyond WebView2 handling covered by the installer.
- A local ArkTS project opens without rewriting project files.
- File tree, editor tabs, Quick Open, and search are stable and keyboard usable.
- Lint and format work as the only explicit validation workflows.
- Git diff and imported patch review are usable without silent file loss.
- ArkTS language features work when the language server is healthy.
- Editing, search, and review remain usable when the language server is missing.
- SDK assumptions stay isolated to Rust infrastructure code.
- Production files remain under the 500-line limit.

## 3. Phase Plan

### Phase A: Project Foundation

Goal: make the repository buildable and testable with the right boundaries.

Source tasks:

- Task 1 from `docs/mvp-implementation-plan.md`

Deliverables:

- Tauri workspace
- frontend and backend test layers
- deterministic package and Rust metadata
- base CI-safe test and build commands

Exit criteria:

- `pnpm test` passes
- `cargo test --manifest-path src-tauri/Cargo.toml` passes
- frontend-to-backend boundary matches `Agent.md`

Stop conditions:

- if frontend code starts reading the filesystem directly
- if bootstrap introduces large catch-all utility files

### Phase B: Shell and Workspace Core

Goal: reach a usable non-semantic editor shell with readable UI and file flows.

Source tasks:

- Task 2
- Task 3
- Task 4
- Task 5
- Task 6

Deliverables:

- IDEA-inspired shell
- readable typography defaults
- workspace open, file tree, recent projects, tabs, dirty state
- CodeMirror integration
- Quick Open and command palette
- ripgrep-based workspace search

Exit criteria:

- a user can open a project, browse files, edit `.ets` files, search text, and
  use shortcuts without ArkTS language support
- UI remains responsive during file open and search
- file and module size discipline is still intact

Hard gates:

- no Electron or Monaco detour
- no SDK dependency leaking into frontend flows
- no unreadable dense UI defaults

### Phase C: ArkTS Intelligence and Validation

Goal: add replaceable ArkTS intelligence while preserving degraded mode.

Source tasks:

- Task 7
- Task 8
- Task 10

Deliverables:

- provider-neutral language contracts
- isolated language-server supervisor and LSP transport
- completion, hover, definition, references, symbols, rename, diagnostics
- configurable lint and format commands
- Problems view
- environment doctor and settings

Exit criteria:

- language features work with pinned `@arkts/language-server`
- editing and search still work if the language server fails to start
- missing SDK or missing lint/format tools degrade gracefully

Hard gates:

- frontend remains free of provider-specific types
- SDK discovery and provider launch logic remain in Rust services
- lint and format remain the only explicit validation workflows

### Phase D: Review Surface and Distribution

Goal: complete the review loop and ship a Windows-usable build.

Source tasks:

- Task 9
- Task 11
- Task 12

Deliverables:

- Git changed-file list
- inline and side-by-side diff
- imported patch review
- Windows portable package
- Windows installer EXE
- CI pipeline
- performance baseline and release notes

Exit criteria:

- package builds on Windows CI
- installer launch works on a clean Windows machine
- sample ArkTS project can be opened and reviewed end to end
- performance targets are measured, not guessed

Hard gates:

- no silent overwrite of unsaved work
- no redistribution of Huawei SDK or HMS SDK files
- no release claim before Windows verification

## 4. Recommended Build Order

Use this order strictly unless a blocker forces a change:

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Phase B checkpoint
8. Task 7
9. Task 8
10. Task 10
11. Phase C checkpoint
12. Task 9
13. Task 11
14. Task 12

Reasoning:

- Task 9 depends on stable document, editor, and search primitives.
- Task 11 is not worth doing before the editor workflows are real.
- Task 12 should measure the near-final product, not a moving prototype.

## 5. Checkpoints

### Checkpoint 1: Editor Baseline

Run after Phase B.

Required result:

- open local project
- browse file tree
- edit and save `.ets`
- Quick Open works
- workspace search works
- UI remains readable and responsive

Decision:

- if this checkpoint is weak, do not start language-service integration yet

### Checkpoint 2: ArkTS Service Boundary

Run after Phase C.

Required result:

- completions and navigation work with the language server
- degraded mode works without it
- missing SDK does not block the editor
- Problems view shows lint, format, and language diagnostics correctly

Decision:

- if graceful degradation is weak, do not move to packaging yet

### Checkpoint 3: Release Candidate

Run after Phase D.

Required result:

- portable package launches
- installer launches
- sample project flow works
- performance numbers are recorded
- acceptance checklist is satisfied

Decision:

- if packaging is correct but performance misses targets, profile before
  changing architecture

## 6. Risks and Controls

### Risk: ArkTS language-server instability on Windows

Control:

- keep the no-op language service path
- lazy-start one process per workspace
- allow one automatic restart only
- keep all editing flows independent of LSP health

### Risk: SDK coupling spreading into frontend code

Control:

- review every SDK-related change against `src/` and `src-tauri/src/services/`
- reject any plan that makes the editor require installed SDK bits to open code

### Risk: UI becomes dense but unpleasant to read

Control:

- centralize typography and spacing tokens
- review at common Windows DPI scales
- check long filenames, tabs, and code glyph clarity early in Phase B

### Risk: file-size discipline erodes during implementation

Control:

- split at roughly 400 lines instead of waiting for 500
- split React views, editor extension files, and Rust services by responsibility
- do not accept “temporary” large files into the MVP

### Risk: WebView2 assumption is mishandled

Control:

- configure a minimum WebView2 version in the Windows bundle settings
- test installer behavior on a clean Windows machine
- document the runtime expectation in README and release notes

### Risk: packaging work starts too early

Control:

- do not start Task 11 until Checkpoint 2 passes

## 7. Weekly Execution Slice

If one engineer is driving the MVP, use this practical slicing:

- Slice 1: Task 1 and Task 2
- Slice 2: Task 3 and Task 4
- Slice 3: Task 5 and Task 6
- Slice 4: Task 7 and Task 8
- Slice 5: Task 10 and Task 9
- Slice 6: Task 11 and Task 12

Each slice should end with:

- updated checkboxes in `docs/mvp-implementation-plan.md`
- a short entry in `gitlog.md`
- one verification note describing what now works

## 8. Definition of “Done Enough to Start Coding”

Planning is sufficient. No further product definition is required before
implementation starts.

The recommended next action is:

1. use `superpowers:subagent-driven-development`
2. execute Task 1 from `docs/mvp-implementation-plan.md`
3. stop after Task 1 for review before broadening scope
