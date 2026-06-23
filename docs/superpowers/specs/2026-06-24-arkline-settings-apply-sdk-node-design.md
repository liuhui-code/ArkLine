# ArkLine Settings Apply SDK Node Design

Date: 2026-06-24
Status: Proposed
Scope: Settings apply/cancel behavior, SDK and Node directory configuration, and semantic feature gating while settings are applying

## Goal

Make Settings changes predictable and keep ArkTS navigation stable.

Users must be able to edit SDK, Node, semantic worker, editor, and validation settings without those draft values immediately affecting go to definition or completion. The new behavior is:

- settings edits stay local to the open dialog until the user clicks Apply
- Cancel and Close discard unapplied edits
- applying settings shows a status-bar progress state
- go to definition and completion are disabled while settings are applying
- SDK and Node path issues are shown as warnings, not blockers
- after Apply completes, jump and completion use the newly saved settings

## Current Behavior

The current settings dialog writes changes immediately through `onChange`.

This means SDK and Node edits can trigger `saveSettings`, `inspectEnvironment`, and semantic state refresh while the user is still typing or browsing. That makes jump and completion vulnerable to half-entered paths or transient values. The current Node picker also treats `nodePath` as a file, while the intended product setting is a Node installation/runtime directory.

## Product Semantics

### SDK Path

`settings.sdk.harmonySdkPath` is a HarmonyOS/OpenHarmony SDK root directory.

A path looks valid when:

- the directory exists
- it contains `ets/`
- it contains `toolchains/`

Invalid or suspicious SDK paths do not block Apply. They show a warning and the applied semantic state may be fallback or degraded.

### Node Path

`settings.sdk.nodePath` is a Node directory, not a direct executable path.

If the value is empty, ArkLine resolves `node` from `PATH`.

If the value is non-empty, ArkLine resolves an executable from the directory:

- Windows: `node.exe`, then `bin/node.exe`
- macOS/Linux: `bin/node`, then `node`

If no executable is found, Apply still saves the setting, but environment and semantic status must report the problem clearly.

### Semantic Worker Path

`settings.sdk.semanticWorkerPath` remains a compiled semantic worker entry file override. It should stay optional. Empty means ArkLine uses its default bundled or repo-local worker entry candidate.

## Recommended Approach

Use dialog-level draft state.

When Settings opens, `SettingsDialog` receives the currently applied settings and creates `draftSettings`. All Settings panels edit that draft. No panel calls the persisted `updateSettings` path directly.

Apply is the only path that saves draft settings and refreshes runtime state. Cancel and Close discard the draft and leave the current applied settings unchanged.

This is intentionally simpler than mixing immediate-save settings with apply-only SDK settings. The entire dialog has one mental model.

## UI Behavior

Settings dialog state:

- `draftSettings`: editable copy of applied settings
- `isDirty`: draft differs from applied settings
- `isApplying`: Apply request is in progress
- `applyError`: last Apply failure, if any

Dialog controls:

- Apply is enabled when `isDirty && !isApplying`
- Apply is disabled while applying
- Cancel is disabled while applying
- Close has the same behavior as Cancel

SDK & Tools hints:

- SDK empty + auto detect on: neutral hint, "ArkLine will try to auto-detect the SDK."
- SDK non-empty but missing: warning
- SDK path is not a directory: warning
- SDK directory missing `ets/` or `toolchains/`: warning
- SDK structure looks correct: ready hint
- Node empty: neutral hint, "ArkLine will resolve node from PATH."
- Node directory missing: warning
- Node path is not a directory: warning
- Node directory exists but no node executable can be inferred: warning
- Node executable can be inferred: ready hint

These draft hints are predictions. The Environment Status section remains the source of truth for the currently applied settings until Apply completes.

## Apply Flow

When the user clicks Apply:

1. Set `settingsApplyState` to applying.
2. Show a status-bar message such as `SDK settings applying...`.
3. Save the complete `draftSettings` via `workspaceApi.saveSettings`.
4. Replace the frontend settings store with `draftSettings`.
5. Update editor appearance from the applied draft.
6. Refresh `inspectEnvironment`.
7. Refresh `inspect_language_service`.
8. Clear `isDirty`.
9. Set `settingsApplyState` to applied.
10. Show a status-bar message such as `SDK settings applied`.

If saving or refresh fails:

- if saving fails, keep the last applied settings active
- if saving succeeds but refresh fails, the saved settings are authoritative because language commands read settings from disk
- show `SDK settings apply failed` for save failures
- show `SDK settings status refresh failed` for refresh failures
- expose the error in the dialog
- clear the applying gate so the user can retry or cancel

An invalid SDK path is not an Apply failure by itself. It is an applied configuration with degraded environment or semantic status.

## Semantic Feature Gating

While `settingsApplyState` is applying:

- `Ctrl+Click` and Go to Definition do not call `goto_definition` or `goto_definition_candidates`
- manual completion does not call `complete_symbol`
- auto completion does not call `complete_symbol`
- the status bar explains that SDK settings are still applying

After Apply completes, go to definition and completion are enabled again. They use the applied settings. Rust `LanguageRuntime` already rebuilds its semantic router when `SemanticHostConfig::from_settings(settings)` changes, so the next language request uses the new configuration.

## Backend Changes

Update Node path resolution in `src-tauri/src/services/semantic_host/process.rs`.

Current behavior validates `nodePath` as a file. The new behavior must interpret it as a directory and infer the executable candidate.

Required behavior:

- empty configured Node path keeps the current PATH lookup
- configured Node path must be treated as a directory
- missing directory returns a clear readiness error
- non-directory returns a clear readiness error
- directory without Node executable returns a clear readiness error
- directory with Node executable returns that executable path

Environment doctor and semantic worker discovery must share the same resolution path. The status panel and actual semantic worker launch must not disagree.

## Frontend Components

Expected frontend changes:

- `SettingsDialog.tsx`
  - own draft state
  - expose Apply and Cancel
  - reset draft when opened
  - call `onApply(draftSettings)` instead of saving per-field
- `SettingsSdkPanel.tsx`
  - edit draft settings
  - show SDK and Node draft validation hints
  - use directory picker for `nodePath`
- `AppShell.tsx`
  - add `settingsApplyState`
  - implement `applySettings`
  - gate definition and completion while applying
  - refresh environment and semantic state after Apply
- `workspace-api.ts`
  - no contract change expected unless tests need a helper

## Error Handling

Apply failures are reserved for persistence or refresh workflow failures.

Examples:

- `saveSettings` rejects
- environment refresh rejects
- semantic state refresh rejects

Warnings are not failures:

- SDK path missing
- SDK root missing expected children
- Node directory missing
- Node executable cannot be inferred
- semantic worker entry missing

Warnings should be visible in Settings and/or Environment Status, while the app remains usable through fallback behavior where available.

## Testing

Frontend tests should cover:

- editing settings does not call `saveSettings` immediately
- Apply saves the complete draft settings
- Apply refreshes environment and semantic state
- Cancel discards draft changes
- Close discards draft changes
- SDK warning does not disable Apply
- applying state disables go to definition calls
- applying state disables manual completion calls
- applying state disables auto completion calls
- Node Browse uses directory picker

Rust tests should cover:

- configured Node directory resolves `bin/node`
- configured Node directory resolves `node`
- Windows-style candidate order covers `node.exe` and `bin/node.exe`
- missing Node directory returns a clear error
- non-directory Node path returns a clear error
- empty Node path still uses PATH lookup

Regression tests should keep existing go to definition and completion flows passing after Apply completes.

## Non-Goals

This design does not add:

- a separate per-section Apply model
- automatic SDK installation
- automatic Node installation
- blocking validation for invalid SDK paths
- a new semantic protocol
- changes to the semantic worker request/response contract

## Acceptance Criteria

- Settings edits do not affect applied configuration until Apply.
- Cancel and Close discard unapplied edits.
- SDK and Node path warnings are visible but do not block Apply.
- Node Path is selected and validated as a directory.
- Apply shows an in-progress status-bar state.
- Definition and completion cannot run while settings are applying.
- After Apply completes, definition and completion use the applied settings.
- Environment status and semantic badge reflect the applied configuration.
