# ArkLine IDEA Shell Design

## Purpose

Define the approved MVP shell and interaction model for ArkLine before the next implementation phase.

This document covers:

- the IDEA-inspired shell layout
- the Project, Problems, Terminal, and Git tool-window structure
- keyboard behavior and focus return rules
- the first real-project validation sample

This document does not add new product scope beyond the confirmed ArkLine MVP.

## Product Positioning

ArkLine is a lightweight Windows-only ArkTS IDE focused on reading, navigation, lint/format feedback, and Git-based review.

The shell should feel strongly familiar to IntelliJ IDEA New UI rather than to a generic web editor. The goal is not to imitate every JetBrains feature, but to preserve the layout logic, tool-window behavior, keyboard expectations, and exit paths that experienced IDEA users already understand.

## Reference Baseline

Approved visual and interaction baseline:

- IntelliJ IDEA New UI (2024 dark)
- Approved ArkLine frozen mockup: [2026-06-19-arkline-idea-reference-approved.html](/Users/liuhui/Documents/code/ArkLine/docs/superpowers/specs/2026-06-19-arkline-idea-reference-approved.html)
- Approved replication direction: `A · Strict IDEA New UI`

Rejected directions:

- overly simplified file tree
- bottom panels shown as three equal-width permanent columns
- a standalone Diff tool window detached from Git workflows
- custom exit behavior that departs from IDEA expectations

### Freeze rule

From this point forward, shell implementation work should treat `A · Strict IDEA New UI` in the approved mockup file as the single visual baseline for:

- top toolbar button presence, density, and weak-button styling
- left activity rail width, active marker, and spacing
- Project tool window title row, tree density, and selected-row treatment
- editor tab height, active-state treatment, and dirty-dot expression
- bottom Git / Problems / Terminal tool-window framing
- status bar thickness, grouping, and subdued emphasis

Further implementation should aim to reproduce that reference faithfully rather than reinterpret the IDEA style at a higher level.

## Approved Shell Layout

### Overall structure

ArkLine should use an IDEA-style shell with four main regions:

1. top application bar
2. left tool-window rail and Project tool window
3. central editor tabs and editor surface
4. bottom tool window

### Top application bar

The top bar should feel close to IDEA New UI:

- restrained dark styling
- application name at the left
- compact menu/action area
- quick global query entry area on the right

It should avoid a web-app toolbar look with oversized buttons or loose spacing.

### Left side

The left side consists of:

- a narrow vertical tool-window icon rail
- the active left tool window, starting with Project

Initial rail targets:

- Project
- Search
- Git
- Problems

No additional left-rail entries are required for MVP.

### Center

The center is a standard editor workspace:

- editor tabs at the top
- active document in the main editor area
- reading-first typography defaults

### Bottom

The bottom area is one unified tool window.

Approved tabs:

- Problems
- Terminal
- Git

Only one bottom tool-window tab is shown as the active content surface at a time.

The bottom area must not render Problems, Terminal, and Git as three equal persistent columns.

## Project Tool Window

### Design goal

The Project tree must feel like a real IDEA project tree, not a placeholder file list.

### Required behavior

- hierarchical folder expansion and collapse
- readable ArkTS project structure
- visible nesting depth
- selected-file highlight that is easy to scan
- compact but not cramped row height
- predictable keyboard selection behavior

### First validation structure

The tree must render well for a small ArkTS UI demo with at least:

- `AppScope/app.json5`
- `entry/src/main/ets/pages/Index.ets`
- `entry/src/main/ets/entryability/EntryAbility.ets`
- `entry/src/main/resources/base/element/string.json`
- `entry/src/main/resources/base/element/color.json`
- `hvigorfile.ts`
- `build-profile.json5`
- `oh-package.json5`

### Visual guidance

- show a realistic expanded state by default for the active path
- keep typography dense and code-reader friendly
- preserve enough indentation to make ArkTS and resources folders understandable at a glance

## Bottom Tool Window

### Model

The bottom area should follow IDEA logic:

- one shared bottom surface
- tab strip for Problems, Terminal, and Git
- switching tabs replaces the main content of the bottom area

### Approved tabs

#### Problems

Problems is reserved for MVP validation feedback and related diagnostics display.

For MVP, the explicit validation workflow remains:

- lint
- format

Syntax and semantic diagnostics may appear as editor assistance, but they are not a separate build pipeline surface.

#### Terminal

Terminal must exist as a first-class bottom tool window.

It should feel like an expected IDE terminal rather than an afterthought:

- obvious open path
- obvious hide path
- clear focus return path to the editor

#### Git

Git is the bottom review tool window.

Diff is not a separate first-level tool window.

Git should contain IDEA-like review states such as:

- Local Changes
- changed-file list
- diff viewer
- patch review import path

## Git Tool Window

### Principle

Git behavior should remain close to IDEA instead of inventing a custom review cockpit.

### Required Git structure

The Git tool window should support:

- Local Changes style entry
- changed-file list
- open selected file diff
- open selected file in editor
- rollback / revert style actions
- stage workflow when present

### Diff placement

Diff belongs inside Git workflows:

- selecting a changed file shows its diff in the Git area
- compare views should follow IDEA mental models
- diff review should not appear as a detached product concept

## Keyboard Model

### Approved shortcut baseline

The MVP keymap should preserve IDEA-like muscle memory as closely as practical.

Approved defaults:

- `Double Shift`: Search Everywhere
- `Ctrl+Shift+A`: Find Action / Command Palette
- `Ctrl+P`: Quick Open file
- `Ctrl+E`: Recent Files
- `Ctrl+Shift+E`: Recent Locations
- `Alt+1`: Project
- `Alt+4`: Problems
- `Alt+9`: Git
- `Alt+F12`: Terminal
- `Ctrl+Tab`: recent editor / tool-window switcher
- `F4` or `Enter`: open selected list item
- `Ctrl+Shift+F12`: editor only

The exact final mapping can be adjusted during implementation if a higher-fidelity IDEA match proves necessary, but MVP must preserve the approved interaction hierarchy and focus model.

## Focus and Exit Rules

### Design principle

Every opened surface must have:

- one obvious keyboard exit path
- one obvious click exit path
- deterministic focus return

### Approved exit hierarchy

- `Esc`: close temporary overlays only
- `Shift+Esc`: hide the currently focused tool window
- `Ctrl+Shift+F12`: hide all surrounding tool windows and keep only the editor

### Temporary overlays closed by Esc

- Search Everywhere
- Quick Open
- Recent Files
- Command Palette
- inline popup surfaces

### Tool windows hidden by Shift+Esc

- Project
- Problems
- Terminal
- Git

### Focus return rule

After a temporary surface or tool window closes, focus should return to the editor unless the user explicitly chose another target.

This rule exists to directly address the current UX problem where function panels can be opened but not exited cleanly.

## Typography and Reading Comfort

Code reading remains a first-class requirement.

Shell implementation must preserve:

- legible programming font defaults
- comfortable line height
- restrained dark contrast similar to IDEA New UI
- no oversized web-style controls
- no loose, card-heavy composition

The shell should read as a compact desktop IDE, not as a browser dashboard.

## Real-Project Validation Sample

### Sample type

Approved first sample:

- small ArkTS UI demo

### First validation checklist

The sample should be used to verify:

1. Project tree hierarchy and expansion
2. Quick Open, Recent Files, and Search Everywhere
3. bottom Problems / Terminal / Git switching
4. Git Local Changes to Diff flow
5. `Esc`, `Shift+Esc`, and `Ctrl+Shift+F12` exit paths

## Out of Scope for This Design

This document does not design:

- build orchestration
- debugger flows
- emulator or preview flows
- test explorer
- non-Git code review systems
- embedded AI chat surfaces

## Acceptance Criteria

The shell design is successful when:

- an IDEA user can predict where Project, Terminal, Problems, and Git live
- the bottom tool window behaves like a single tool-window surface, not a custom split dashboard
- Git review feels like an IDEA-style Local Changes flow
- every popup and tool window has a reliable exit path
- a small ArkTS project is readable and navigable without layout confusion

## Implementation Implications

The next implementation phase should prioritize:

1. restructuring the shell toward the approved IDEA layout
2. replacing current bottom split behavior with a true tabbed bottom tool window
3. making Git the owner of diff presentation
4. enforcing the approved keyboard and focus rules
5. validating the result against the small ArkTS UI demo sample
