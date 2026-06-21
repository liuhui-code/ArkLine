# ArkLine

ArkLine is a lightweight ArkTS IDE focused on four things:

- reading code comfortably
- navigating code fast
- running `lint` / `format`
- reviewing Git changes in an IDEA-like shell

The product target is Windows desktop. macOS is currently used as a development
and validation environment.

## Why ArkLine

ArkLine is not trying to be a full generic IDE.

The first version is intentionally narrow:

- keep the traditional editor experience that developers already rely on
- keep code reading and file navigation efficient
- keep `lint` / `format` close at hand
- keep Git review inside the same shell
- avoid the weight and complexity of a large all-in-one IDE before the ArkTS query stack is truly ready

The direction is a Windows-first, IDEA-inspired ArkTS workspace that stays light,
fast to search, and comfortable for long reading sessions.

## Current MVP

This repository currently includes:

- Tauri v2 desktop host with React + TypeScript + Vite
- IDEA-inspired shell with Project, Search, editor tabs, bottom tool windows, and status bar
- CodeMirror 6 editor for `.ets`, `.ts`, and `.json5`
- File menu, recent projects, recent files, Search Everywhere, Quick Open, and Find Action
- keyboard flows aligned toward IntelliJ IDEA habits
- bottom Terminal, Problems, Git, and Usages surfaces
- `Ctrl+B`, `Ctrl+Click`, `Ctrl+Space`, and `Alt+F7` MVP wiring for code query flows
- lint / format command configuration and validation entry points
- Windows packaging and CI baseline

## Product status

ArkLine is currently an engineering MVP.

- the shell and editor workflow are already usable
- project opening, file browsing, search flows, editing, and Git diff review are in place
- ArkTS semantic capabilities are partially wired but not yet strong enough to claim IntelliJ-class behavior
- packaging is designed for Windows first, with macOS used mainly for development verification

## Quick start

### Windows

This is the main target platform.

#### Fastest way for users

1. Download the packaged ArkLine installer or `.exe` from the GitHub release or CI artifact.
2. Install Microsoft WebView2 Runtime if the machine does not already have it.
3. Launch ArkLine.
4. Use `File -> Open Project...` to select an ArkTS workspace folder.

#### Fastest way for developers

Prerequisites:

- Node.js 20+
- `pnpm`
- Rust stable toolchain
- Microsoft C++ Build Tools
- WebView2 Runtime

Run:

```bash
pnpm install
pnpm tauri dev
```

Build a distributable Windows package:

```bash
pnpm build
pnpm package:windows
```

Run a Windows dependency check plus build flow:

```powershell
pnpm check:windows-build
```

Useful flags:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-windows-build.ps1 -SkipInstall
powershell -ExecutionPolicy Bypass -File scripts/check-windows-build.ps1 -SkipFrontendBuild
powershell -ExecutionPolicy Bypass -File scripts/check-windows-build.ps1 -SkipBundle
```

Relevant files:

- CI workflow: [.github/workflows/windows-ci.yml](/Users/liuhui/Documents/code/ArkLine/.github/workflows/windows-ci.yml)
- Windows preflight helper: [scripts/check-windows-build.ps1](/Users/liuhui/Documents/code/ArkLine/scripts/check-windows-build.ps1)
- Packaging script: [scripts/package-windows.ps1](/Users/liuhui/Documents/code/ArkLine/scripts/package-windows.ps1)

### macOS

macOS is not the product target for ArkLine, but it is supported for local
development and interaction testing.

Prerequisites:

- Node.js 20+
- `pnpm`
- Rust stable toolchain
- Xcode Command Line Tools

Run locally:

```bash
pnpm install
pnpm tauri dev
```

Run verification:

```bash
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Notes:

- Use macOS mainly to verify frontend, shell interaction, and workspace loading.
- The first packaged end-user experience should still be treated as Windows-first.

## First-use flow

1. Open a project from `File -> Open Project...`
2. Select an ArkTS workspace directory
3. Browse files in the left Project tool window
4. Open search flows with the top toolbar or keyboard shortcuts
5. Run lint / format from the Terminal presets or configured actions
6. Review changed files in the bottom Git tool window

## Core shortcuts

The shell is intentionally aligned toward IntelliJ IDEA habits.

| Action | Shortcut |
| --- | --- |
| Search Everywhere | `Shift` twice / toolbar search |
| Quick Open | `Ctrl+P` |
| Find Action | `Ctrl+Shift+A` |
| Save | `Ctrl+S` |
| Go to Definition | `Ctrl+B` |
| Code Completion | `Ctrl+Space` |
| Find Usages | `Alt+F7` |
| Project tool window | `Alt+1` |
| Git tool window | `Alt+9` |
| Terminal tool window | `Alt+F12` |
| Hide active tool window | `Shift+Esc` |
| Editor-only mode toggle | `Ctrl+Shift+F12` |

## Architecture snapshot

ArkLine is split into a small desktop host and a web-based UI shell:

- `src-tauri/`: Tauri v2 host, filesystem commands, settings, terminal runner, language-service adapter skeleton
- `src/`: React shell, CodeMirror editor, tool windows, query overlays, workspace state
- `tests/frontend/`: editor and shell interaction regression coverage
- `docs/`: MVP plan, editor capability matrix, performance notes, and approved shell specs

Important constraints in the current codebase:

- SQLite is not part of ArkLine; this project is a desktop IDE shell, not a backend service
- large “god files” are intentionally avoided, and shell code has already been split to keep major files under control
- ArkTS SDK dependence should stay isolated behind service boundaries rather than spreading through UI code

## Repository map

- Product brief: [Agent.md](/Users/liuhui/Documents/code/ArkLine/Agent.md)
- MVP execution notes: [docs/mvp-execution-plan.md](/Users/liuhui/Documents/code/ArkLine/docs/mvp-execution-plan.md)
- MVP implementation plan: [docs/mvp-implementation-plan.md](/Users/liuhui/Documents/code/ArkLine/docs/mvp-implementation-plan.md)
- Editor capability matrix: [docs/editor-capability-matrix.md](/Users/liuhui/Documents/code/ArkLine/docs/editor-capability-matrix.md)
- Release draft: [docs/releases/v0.1.0-draft.md](/Users/liuhui/Documents/code/ArkLine/docs/releases/v0.1.0-draft.md)
- Screenshot checklist: [docs/releases/screenshot-checklist.md](/Users/liuhui/Documents/code/ArkLine/docs/releases/screenshot-checklist.md)
- Development log: [gitlog.md](/Users/liuhui/Documents/code/ArkLine/gitlog.md)

## Near-term roadmap

1. Replace MVP semantic fallbacks with a stable ArkTS language-service integration
2. Raise click-through navigation, completion quality, and usages accuracy toward IDEA expectations
3. Strengthen Git workflows beyond diff viewing into a more complete IDEA-like daily flow
4. Validate Windows packaging on a real target machine and publish a first usable installer
5. Continue tightening shell density, readability, and keyboard ergonomics

## Current limitations

- Full ArkTS language-service integration is still incomplete.
- Definition, completion, and usages are MVP-level and not yet at IntelliJ IDEA depth.
- `lint` / `format` execution is still a configurable shell-driven flow, not a deeply integrated ArkTS toolchain bridge.
- Terminal is intentionally narrow-scope MVP, not a full PTY terminal emulator with tabs and splits.
- Git history, branches, staging, and merge tooling are still much lighter than real IDEA Git support.
- Windows installer and portable executable still need final validation on a real Windows machine.

## Development

```bash
pnpm install
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
pnpm tauri dev
pnpm package:windows
```
