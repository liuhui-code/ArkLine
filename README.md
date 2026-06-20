# ArkLine

ArkLine is a lightweight ArkTS IDE focused on four things:

- reading code comfortably
- navigating code fast
- running `lint` / `format`
- reviewing Git changes in an IDEA-like shell

The product target is Windows desktop. macOS is currently used as a development
and validation environment.

## MVP scope

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

Relevant files:

- CI workflow: [.github/workflows/windows-ci.yml](/Users/liuhui/Documents/code/ArkLine/.github/workflows/windows-ci.yml)
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

## How to use ArkLine

1. Open a project from `File -> Open Project...`
2. Select an ArkTS workspace directory
3. Browse files in the left Project tool window
4. Open search flows with the top toolbar or keyboard shortcuts
5. Run lint / format from the Terminal presets or configured actions
6. Review changed files in the bottom Git tool window

## Current limitations

- Full ArkTS language-service integration is still incomplete.
- Definition, completion, and usages are MVP-level and not yet at IntelliJ IDEA depth.
- `lint` / `format` execution is still a configurable shell-driven flow, not a deeply integrated ArkTS toolchain bridge.
- Terminal is intentionally narrow-scope MVP, not a full PTY terminal emulator with tabs and splits.
- Git history, branches, staging, and merge tooling are still much lighter than real IDEA Git support.
- Windows installer and portable executable still need final validation on a real Windows machine.

## Development commands

```bash
pnpm install
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
pnpm tauri dev
pnpm package:windows
```
