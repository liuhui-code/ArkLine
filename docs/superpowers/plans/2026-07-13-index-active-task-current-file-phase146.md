# Phase 146: Active Index Task Current File Target

## Goal

Make the live index task strip explain whether the active task is working on the current editor file.

## Why

Large projects often have background project, SDK, and foreground file indexing active at the same time. Users need to know whether a slow navigation or completion request is waiting on the current file, or whether the visible task is unrelated background work.

## Changes

- Active task summaries now accept the current editor path.
- Target path matching normalizes slash direction and case before comparison.
- The active task strip prefixes matching target summaries with `Current file`.
- The current-file indexing action uses the same normalized matching before disabling duplicate foreground indexing.

## Verification

- Unit coverage checks current-file target detection with Windows-style paths.
- UI coverage checks the active task strip renders the `Current file` target marker.
- Layer action coverage checks normalized target matching disables duplicate current-file indexing.
