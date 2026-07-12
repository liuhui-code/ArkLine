# Git Blame Marker Click Phase 75

## Goal

Make inline Git blame gutter markers reliably open the Git Blame Details card.

## Root Cause

The blame marker was rendered as a button inside a CodeMirror gutter, but selection relied on the gutter-level `domEventHandlers.mousedown` path. In the AppShell test environment that handler did not fire for the nested marker button, so the controller never received `selectGitBlameLine` and `selectedBlameAttribution` stayed empty.

## Scope

- Keep the existing gutter marker rendering and label behavior.
- Move the primary marker activation handler onto the marker button itself.
- Handle mouse activation on `mousedown` to keep editor focus behavior stable.
- Handle `click` as a keyboard/accessibility fallback without double-selecting after mouse activation.
- Avoid changing Git trace panel, blame attribution mapping, or Git tool window behavior.

## Verification

- The previously failing inline blame marker click test passes.
- Adjacent Git blame card, copy hash, local diff, current-line blame, toggle, status menu, and Escape-close paths pass.
- Build, runtime perf, diff whitespace, line count, and git status gates before commit.
