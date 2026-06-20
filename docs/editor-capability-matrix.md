# ArkLine Editor Capability Matrix

Last updated: 2026-06-20

## Purpose

This document turns "IDEA-like editor behavior" into a concrete acceptance matrix
for ArkLine. Each capability is tracked by four dimensions:

- `Target`: the IDEA behavior ArkLine should approximate in MVP or the next phase
- `Current`: what ArkLine actually does today
- `Status`: `done`, `partial`, or `missing`
- `Verification`: how we prove the behavior works

This is the source of truth for editor and code-query work. Do not describe a
capability as "supported" unless it has both an implementation and a matching
verification path.

## Current Editor Baseline

ArkLine currently uses:

- `CodeMirror 6` for text editing and rendering
- local document state in the frontend
- local path search and file opening
- local ArkTS formatting function
- lint/format validation surfaces
- no ArkTS language service connected yet

That means ArkLine already behaves like a lightweight code editor, but not yet
like a semantic IDE.

## Acceptance Matrix

| Capability | IDEA baseline | Current ArkLine behavior | Status | Verification |
|---|---|---|---|---|
| Typing stability | typing must not recreate the editor or lose cursor/selection | fixed; CodeMirror instance stays alive across controlled updates | done | automated frontend test |
| Caret movement | arrows, home/end, mouse click, continued typing from current caret | basic CodeMirror behavior is present | partial | automated frontend test + manual smoke |
| Selection editing | replace selected text, extend selection by keyboard/mouse | provided by CodeMirror, not yet covered by tests | partial | add automated test |
| Undo / Redo | IDEA-style local editing history | CodeMirror history extension is enabled | partial | add automated test |
| Line numbers | visible gutter with active line context | present | done | visual + existing code inspection |
| Bracket matching | matching bracket feedback while editing | present | done | manual smoke |
| Syntax highlighting | ArkTS/TS/JSON5 token coloring | present through CodeMirror language packages | done | manual smoke |
| Editor tabs | open file tabs, active tab, dirty mark | present | done | existing shell tests |
| Save | `Ctrl/Cmd+S` saves active file | present | done | automated shell test |
| Format action | toolbar/menu format action on active file | present | done | automated shell test |
| Format on save | save can normalize content before persistence | present | done | automated shell test |
| Lint / format diagnostics | problems panel should show findings after save or manual lint | present for lint/format only | done | automated shell test |
| Quick Open | open file by path fragment with keyboard | present | done | automated shell test |
| Recent Files | open recent file list from keyboard | present at shell level | partial | add targeted automated test |
| Search Everywhere | workspace-wide file lookup surface | present as file/path query overlay | partial | add targeted automated test |
| Project tree selection | clicked file should open and remain visibly selected | present after Unix path fix | done | automated project-tree test |
| Go to line | direct line navigation | not implemented | missing | implement + test |
| Go to definition | click or shortcut to definition target | not implemented | missing | requires language service |
| Find usages | show references / callers of symbol | not implemented | missing | requires language service |
| Hover documentation | symbol hover info | not implemented | missing | requires language service |
| Auto completion | context-aware completion popup | not implemented | missing | requires language service |
| Signature help | parameter hints while typing calls | not implemented | missing | requires language service |
| Rename symbol | semantic rename across workspace | not implemented | missing | requires language service |
| Document symbols / outline | file-level symbol navigation | not implemented | missing | requires language service |
| Workspace symbols | cross-file symbol lookup | not implemented | missing | requires language service |
| Find implementation | jump to concrete implementors | not implemented | missing | requires language service |
| Code actions / quick fix | light-bulb style fixes | not implemented | missing | requires language service |
| Peek definition / inline usages | inspect symbol target without full file jump | not implemented | missing | post-MVP |

## What "IDEA-like" Means for ArkLine

For ArkLine, "IDEA-like" does not mean copying every IntelliJ feature. It means:

1. Editing must feel stable and fast.
2. File and symbol lookup must be keyboard-first.
3. Semantic actions must behave predictably and return precise targets.
4. Verification must exist for every claimed capability.

The first release should prioritize editing trust and read/query speed over broad
feature count.

## Gaps That Block True IDE Behavior

The main blocker is not UI polish. It is the absence of a stable ArkTS semantic
backend.

Without a real ArkTS language service, ArkLine cannot truthfully provide:

- semantic completion
- jump to definition
- find usages
- hover
- rename
- outline / symbols

Any attempt to fake these features with string matching would produce incorrect
results and damage trust.

## Recommended Implementation Order

### Phase A: Finish editor-core trust

These do not require a language service and should be completed first:

1. caret movement regression tests
2. selection editing tests
3. undo/redo tests
4. recent-files query tests
5. search-everywhere query tests
6. go-to-line

### Phase B: Add language-service adapter

This is the hard prerequisite for semantic IDE behavior:

1. define a Rust LSP adapter boundary isolated from frontend feature code
2. spawn and supervise one ArkTS language-service process per workspace
3. map standard LSP requests and notifications through Tauri commands/events
4. degrade safely when the service is missing or crashes

### Phase C: Deliver minimum semantic navigation

This is the smallest useful semantic set:

1. completion
2. hover
3. go to definition
4. document symbols

These four are the minimum threshold for calling ArkLine an IDE rather than only
an editor.

### Phase D: Deliver workspace-scale query features

After semantic navigation is stable:

1. find usages
2. workspace symbols
3. rename symbol
4. signature help

## Verification Strategy

Use three layers only:

### Automated frontend tests

Use for:

- editing stability
- keyboard flows
- tab state
- query overlay behavior
- problems panel behavior

### Backend integration tests

Use for:

- workspace scanning
- path normalization
- language-service adapter behavior
- tool failure handling

### Manual semantic smoke tests

Use only after a real language service exists. Minimum smoke project checks:

1. open a small ArkTS workspace
2. trigger completion inside a component body
3. jump from symbol use to definition
4. list usages of a symbol used in multiple files
5. rename one symbol and verify all expected files update

## Shortcut Baseline To Preserve

These should remain stable while editor/query features are added:

| Action | Current shortcut |
|---|---|
| Save | `Ctrl/Cmd+S` |
| Quick Open | `Ctrl/Cmd+P` |
| Recent Files | `Ctrl/Cmd+E` |
| Command Palette | `Ctrl/Cmd+Shift+A` |
| Hide active tool window | `Shift+Escape` |
| Close transient UI | `Escape` |
| Project | `Alt+1` |
| Problems | `Alt+4` |
| Git | `Alt+9` |
| Terminal | `Alt+F12` |

Do not reuse these bindings for language-service features. Definition, usages,
rename, and completion should be added with IDEA-aligned defaults in a later pass.

## Near-Term Definition of Done

ArkLine can claim a trustworthy editor MVP only when all of these are true:

- typing never loses caret or editor instance
- save, format, and diagnostics are stable
- file queries are keyboard-first and tested
- project-tree selection stays consistent
- editor regression coverage exists for caret, selection, and undo/redo

ArkLine can claim a semantic IDE milestone only when all of these are true:

- a real ArkTS language service is wired through an isolated adapter
- completion works on a real ArkTS sample project
- go to definition works on a real ArkTS sample project
- hover and document symbols work on a real ArkTS sample project
- each capability has both automated coverage and a manual semantic smoke path
