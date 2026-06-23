# ArkLine Settings Apply SDK Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Settings edits draft-only until Apply, treat SDK and Node as directories with warnings, and block definition/completion while settings are applying.

**Architecture:** Keep the current settings store and Tauri command contracts. Move save orchestration into `AppShell`, let `SettingsDialog` own draft UI state, and update Rust semantic worker discovery so `nodePath` means a directory that resolves to a Node executable. Definition and completion entry points share a single applying gate.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tauri v2, Rust, cargo tests

---

## File Structure

### Existing files to modify

- `src/components/settings/SettingsDialog.tsx`
  - owns `draftSettings`, dirty state, Apply/Cancel controls, and draft reset on open
- `src/components/settings/settings-sections/SettingsSdkPanel.tsx`
  - edits draft settings, shows SDK/Node warning hints, keeps environment status as applied-state truth
- `src/components/layout/AppShell.tsx`
  - replaces immediate `updateSettings` save path with `applySettings`, gates definition/completion while applying, uses directory picker for Node
- `src/components/layout/ShellStatusBar.tsx`
  - shows applying/applied/failed status text through existing `statusText` and right status pill
- `src-tauri/src/services/semantic_host/process.rs`
  - resolves configured `nodePath` as a directory, while empty path keeps PATH lookup
- `tests/frontend/app-shell.test.tsx`
  - locks Apply/Cancel behavior, Node directory picker, warning-not-blocking, and semantic gating

### Files not expected to change

- `src/features/settings/settings-store.ts`
  - existing shape is sufficient
- `src/features/workspace/workspace-api.ts`
  - picker API already supports `{ directory: true }`
- `src-tauri/src/commands/settings.rs`
  - save/load contract remains unchanged
- `src-tauri/src/commands/language.rs`
  - language commands already load applied settings from disk

## Task 1: Make Settings Draft-Only With Apply and Cancel

**Files:**
- Modify: `tests/frontend/app-shell.test.tsx`
- Modify: `src/components/settings/SettingsDialog.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Write the failing frontend test**

Add this test near the existing settings tests in `tests/frontend/app-shell.test.tsx`:

```tsx
it("keeps settings edits as a draft until Apply and discards them on Cancel", async () => {
  const user = userEvent.setup();
  const savedSettings = defaultSettings();
  const saveSettings = vi.fn(async () => undefined);
  const workspaceApi = createWorkspaceApi({
    loadSettings: async () => savedSettings,
    saveSettings,
    inspectEnvironment: vi.fn(async () => ({ tools: [] })),
    inspectLanguageService: vi.fn(async () => ({
      provider: "mock-fallback",
      mode: "fallback",
      running: true,
      hover: true,
      definition: true,
      completion: true,
      documentSymbols: true,
      findUsages: true,
      detail: "ready",
    })),
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: "Editor" }));
  const fontSize = await screen.findByLabelText("Font Size");
  await user.clear(fontSize);
  await user.type(fontSize, "18");

  expect(saveSettings).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: "Editor" }));

  expect(await screen.findByLabelText("Font Size")).toHaveValue(14);

  await user.clear(screen.getByLabelText("Font Size"));
  await user.type(screen.getByLabelText("Font Size"), "17");
  await user.click(screen.getByRole("button", { name: "Apply" }));

  await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
  expect(saveSettings).toHaveBeenLastCalledWith(
    expect.objectContaining({
      editor: expect.objectContaining({ fontSize: 17 }),
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx -t "keeps settings edits as a draft"`

Expected: FAIL because Settings currently saves on each edit and has no Apply/Cancel buttons.

- [ ] **Step 3: Change `SettingsDialog` props and draft state**

In `src/components/settings/SettingsDialog.tsx`, replace the `onChange` prop with `onApply`, add local draft state, and render footer actions:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { AppSettings, AppSettingsPatch } from "@/features/settings/settings-store";

type SettingsDialogProps = {
  environmentReport: EnvironmentReport | null;
  onApply: (settings: AppSettings) => Promise<void>;
  onClose: () => void;
  onPickPath: (field: "harmonySdkPath" | "semanticWorkerPath" | "nodePath") => Promise<string | null>;
  onRefreshEnvironment: () => void;
  open: boolean;
  saveStateLabel: string;
  settings: AppSettings;
};

function mergeDraftSettings(current: AppSettings, update: AppSettingsPatch): AppSettings {
  return {
    editor: { ...current.editor, ...update.editor },
    sdk: { ...current.sdk, ...update.sdk },
    validation: { ...current.validation, ...update.validation },
    recentProjects: update.recentProjects ?? current.recentProjects,
  };
}

function sameSettings(left: AppSettings, right: AppSettings) {
  return JSON.stringify(left) === JSON.stringify(right);
}
```

Inside the component:

```tsx
const [draftSettings, setDraftSettings] = useState(settings);
const [isApplying, setIsApplying] = useState(false);
const [applyError, setApplyError] = useState("");
const isDirty = useMemo(() => !sameSettings(draftSettings, settings), [draftSettings, settings]);

useEffect(() => {
  if (open) {
    setActiveSection("sdk");
    setDraftSettings(settings);
    setApplyError("");
    setIsApplying(false);
  }
}, [open, settings]);

function updateDraft(update: AppSettingsPatch) {
  setDraftSettings((current) => mergeDraftSettings(current, update));
  setApplyError("");
}

async function applyDraft() {
  setIsApplying(true);
  setApplyError("");
  try {
    await onApply(draftSettings);
  } catch (error) {
    setApplyError(error instanceof Error ? error.message : String(error));
  } finally {
    setIsApplying(false);
  }
}
```

Pass `draftSettings` and `updateDraft` to all panels. Replace the header Close button with disabled-while-applying Cancel semantics:

```tsx
<button type="button" className="toolbar__button" disabled={isApplying} onClick={onClose}>
  Close
</button>
```

Add a footer after the dialog body:

```tsx
<footer className="settings-dialog__footer">
  {applyError ? <span className="settings-save-state settings-save-state--error">{applyError}</span> : null}
  <button type="button" className="toolbar__button" disabled={isApplying} onClick={onClose}>
    Cancel
  </button>
  <button
    type="button"
    className="toolbar__button toolbar__button--primary"
    disabled={!isDirty || isApplying}
    onClick={() => void applyDraft()}
  >
    {isApplying ? "Applying..." : "Apply"}
  </button>
</footer>
```

- [ ] **Step 4: Change `AppShell` save orchestration**

In `src/components/layout/AppShell.tsx`, replace `updateSettings(update: AppSettingsPatch)` with:

```tsx
async function applySettings(nextSettings: AppSettings) {
  setSettingsSaveState("saving");
  setStatusText("SDK settings applying...");
  clearSettingsSaveResetTimer();
  await workspaceApi.saveSettings(nextSettings);
  settingsRef.current.replace(nextSettings);
  setEditorAppearance({ ...nextSettings.editor });
  setRecentProjects([...nextSettings.recentProjects]);
  await refreshEnvironmentReport();
  await refreshSemanticState();
  setSettingsSaveState("saved");
  setStatusText("SDK settings applied");
  settingsSaveResetTimerRef.current = window.setTimeout(() => {
    setSettingsSaveState("idle");
    settingsSaveResetTimerRef.current = null;
  }, 1200);
}
```

Update the `SettingsDialog` call:

```tsx
<SettingsDialog
  environmentReport={environmentReport}
  onApply={applySettings}
  onClose={() => setSettingsVisible(false)}
  onPickPath={pickSettingsPath}
  onRefreshEnvironment={refreshEnvironmentReport}
  open={settingsVisible}
  saveStateLabel={settingsSaveStateLabel}
  settings={settingsRef.current.state.settings}
/>
```

- [ ] **Step 5: Run the focused test**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx -t "keeps settings edits as a draft"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/SettingsDialog.tsx src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: apply settings from dialog draft"
```

## Task 2: Add SDK and Node Directory Warnings and Node Directory Picker

**Files:**
- Modify: `tests/frontend/app-shell.test.tsx`
- Modify: `src/components/settings/settings-sections/SettingsSdkPanel.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Write failing tests for warnings and Node picker**

Add these tests near the settings tests:

```tsx
it("warns about suspicious SDK paths without blocking Apply", async () => {
  const user = userEvent.setup();
  const saveSettings = vi.fn(async () => undefined);
  const workspaceApi = createWorkspaceApi({ saveSettings });

  render(<AppShell workspaceApi={workspaceApi} />);

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
  await user.clear(await screen.findByLabelText("HarmonyOS / ArkTS SDK Path"));
  await user.type(screen.getByLabelText("HarmonyOS / ArkTS SDK Path"), "Z:/missing-sdk");

  expect(screen.getByText(/SDK path has not been verified yet/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(saveSettings).toHaveBeenCalled());
});

it("uses a directory picker for Node Path", async () => {
  const user = userEvent.setup();
  const pickPath = vi.fn(async () => "C:/Program Files/nodejs");
  const workspaceApi = createWorkspaceApi({ pickPath });

  render(<AppShell workspaceApi={workspaceApi} />);

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
  await user.click(screen.getAllByRole("button", { name: "Browse..." })[2]);

  expect(pickPath).toHaveBeenCalledWith({
    directory: true,
    title: "Select Node Directory",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx -t "warns about suspicious SDK paths|uses a directory picker for Node Path"`

Expected: FAIL because warning text and Node directory picker behavior do not exist yet.

- [ ] **Step 3: Add draft path hints to `SettingsSdkPanel`**

In `src/components/settings/settings-sections/SettingsSdkPanel.tsx`, add helper functions above the component:

```tsx
type PathHint = {
  tone: "neutral" | "warning" | "ready";
  text: string;
};

function sdkPathHint(settings: AppSettings): PathHint {
  const value = settings.sdk.harmonySdkPath.trim();
  if (!value && settings.sdk.autoDetect) {
    return { tone: "neutral", text: "ArkLine will try to auto-detect the SDK." };
  }
  if (!value) {
    return { tone: "warning", text: "SDK path is empty and auto-detect is off; semantic features may use fallback." };
  }
  return { tone: "warning", text: "SDK path has not been verified yet. Apply and check Environment Status for the authoritative result." };
}

function nodePathHint(settings: AppSettings): PathHint {
  const value = settings.sdk.nodePath.trim();
  if (!value) {
    return { tone: "neutral", text: "ArkLine will resolve node from PATH." };
  }
  return { tone: "warning", text: "Node directory has not been verified yet. Apply and check Environment Status for the authoritative result." };
}

function SettingsHint({ hint }: { hint: PathHint }) {
  return <span className={`settings-field__hint settings-field__hint--${hint.tone}`}>{hint.text}</span>;
}
```

Render hints below SDK and Node input rows:

```tsx
<SettingsHint hint={sdkPathHint(settings)} />
```

and:

```tsx
<SettingsHint hint={nodePathHint(settings)} />
```

- [ ] **Step 4: Change Node picker to directory**

In `src/components/layout/AppShell.tsx`, update `pickSettingsPath`:

```tsx
async function pickSettingsPath(field: "harmonySdkPath" | "semanticWorkerPath" | "nodePath") {
  const title =
    field === "harmonySdkPath" ? "Select HarmonyOS / ArkTS SDK Path"
    : field === "semanticWorkerPath" ? "Select ArkTS LSP / Semantic Worker Path"
    : "Select Node Directory";
  const selectedPath = await workspaceApi.pickPath?.({
    directory: field !== "semanticWorkerPath",
    title,
  });
  return selectedPath ?? null;
}
```

In `SettingsSdkPanel.tsx`, make Browse update the draft after awaiting:

```tsx
onClick={() => {
  void onPickPath("nodePath").then((selectedPath) => {
    if (selectedPath) onChange({ sdk: { nodePath: selectedPath } });
  });
}}
```

Apply the same pattern for `harmonySdkPath` and `semanticWorkerPath`.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx -t "warns about suspicious SDK paths|uses a directory picker for Node Path"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/settings-sections/SettingsSdkPanel.tsx src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: warn for sdk node draft paths"
```

## Task 3: Gate Definition and Completion While Settings Apply

**Files:**
- Modify: `tests/frontend/app-shell.test.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [ ] **Step 1: Write the failing semantic gating test**

Add this test near existing definition/completion tests:

```tsx
it("blocks definition and completion while settings are applying", async () => {
  const user = userEvent.setup();
  let finishSave!: () => void;
  const saveSettings = vi.fn(() => new Promise<void>((resolve) => {
    finishSave = resolve;
  }));
  const gotoDefinition = vi.fn(async () => ({ path: "C:/samples/DemoWorkspace/src/main.ets", line: 1, column: 1 }));
  const completeSymbol = vi.fn(async () => [{ label: "build", kind: "method" }]);
  const workspaceApi = createWorkspaceApi({ saveSettings, gotoDefinition, completeSymbol });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
  await user.clear(await screen.findByLabelText("HarmonyOS / ArkTS SDK Path"));
  await user.type(screen.getByLabelText("HarmonyOS / ArkTS SDK Path"), "D:/HarmonyOS/Sdk");
  await user.click(screen.getByRole("button", { name: "Apply" }));

  expect(await screen.findByText("SDK settings applying...")).toBeVisible();

  await user.keyboard("{Control>}b{/Control}");
  await user.keyboard("{Control>} {/Control}");

  expect(gotoDefinition).not.toHaveBeenCalled();
  expect(completeSymbol).not.toHaveBeenCalled();

  finishSave();
  await waitFor(() => expect(screen.getByText("SDK settings applied")).toBeVisible());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx -t "blocks definition and completion while settings are applying"`

Expected: FAIL because semantic actions are not gated by applying state.

- [ ] **Step 3: Add applying state and gate checks**

In `AppShell.tsx`, add:

```tsx
const [settingsApplyState, setSettingsApplyState] = useState<"idle" | "applying" | "applied" | "failed">("idle");
const settingsApplying = settingsApplyState === "applying";
```

At the start of `applySettings`:

```tsx
setSettingsApplyState("applying");
```

After successful refresh:

```tsx
setSettingsApplyState("applied");
```

On failure:

```tsx
setSettingsApplyState("failed");
setStatusText(`SDK settings apply failed: ${error instanceof Error ? error.message : String(error)}`);
throw error;
```

At the start of `goToDefinitionFromEditor` after the modifier-click position check:

```tsx
if (settingsApplying) {
  if (source === "modifierClick") {
    setDefinitionDebug("Ctrl+Click is paused while SDK settings are applying.");
  }
  setStatusText("SDK settings are still applying");
  return;
}
```

At the start of `requestCompletion`:

```tsx
if (settingsApplying) {
  setStatusText("SDK settings are still applying");
  return;
}
```

At the start of `triggerTypingCompletion`:

```tsx
if (settingsApplying) {
  setStatusText("SDK settings are still applying");
  return;
}
```

- [ ] **Step 4: Run the focused test**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx -t "blocks definition and completion while settings are applying"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: gate semantic actions while settings apply"
```

## Task 4: Resolve Configured Node Path as a Directory

**Files:**
- Modify: `src-tauri/src/services/semantic_host/process.rs`

- [ ] **Step 1: Write failing Rust tests**

In `src-tauri/src/services/semantic_host/process.rs`, extend the test module imports and add:

```rust
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_temp_dir(name: &str) -> std::path::PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

#[test]
fn resolves_configured_node_directory_bin_node() {
    let root = unique_temp_dir("node-bin");
    let bin = root.join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::write(bin.join("node"), "").unwrap();

    let resolved = resolve_node_path(Some(root.to_string_lossy().as_ref()), "macos").unwrap();

    assert_eq!(resolved, bin.join("node"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn resolves_configured_node_directory_direct_node() {
    let root = unique_temp_dir("node-direct");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("node"), "").unwrap();

    let resolved = resolve_node_path(Some(root.to_string_lossy().as_ref()), "linux").unwrap();

    assert_eq!(resolved, root.join("node"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_configured_node_directory_without_executable() {
    let root = unique_temp_dir("node-missing");
    fs::create_dir_all(&root).unwrap();

    let error = resolve_node_path(Some(root.to_string_lossy().as_ref()), "macos").unwrap_err();

    assert!(error.contains("directory does not contain a Node executable"));
    fs::remove_dir_all(root).unwrap();
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml resolve_configured_node_directory`

Expected: FAIL because `resolve_node_path` currently validates configured Node path as a file.

- [ ] **Step 3: Implement Node directory resolution**

In `src-tauri/src/services/semantic_host/process.rs`, replace `resolve_node_path` and add `resolve_node_directory`:

```rust
fn resolve_node_path(configured: Option<&str>, platform: &str) -> Result<PathBuf, String> {
    if let Some(path) = configured {
        return resolve_node_directory(PathBuf::from(path), platform);
    }

    let lookup_command = if platform == "windows" { "where" } else { "which" };
    let output = Command::new(lookup_command)
        .arg("node")
        .output()
        .map_err(|error| format!("Node runtime is required for the ArkLine semantic worker: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "Node runtime is required for the ArkLine semantic worker{}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let stdout_text = String::from_utf8_lossy(&output.stdout).to_string();
    let first_line = stdout_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "Node runtime is required for the ArkLine semantic worker".to_string())?;

    Ok(PathBuf::from(first_line.trim()))
}

fn resolve_node_directory(path: PathBuf, platform: &str) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("{ARKLINE_NODE_PATH_ENV} directory does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("{ARKLINE_NODE_PATH_ENV} path is not a directory: {}", path.display()));
    }

    let candidates = if platform == "windows" {
        vec![path.join("node.exe"), path.join("bin").join("node.exe")]
    } else {
        vec![path.join("bin").join("node"), path.join("node")]
    };

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            format!(
                "{ARKLINE_NODE_PATH_ENV} directory does not contain a Node executable: {}",
                path.display()
            )
        })
}
```

- [ ] **Step 4: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml resolve_configured_node_directory`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/semantic_host/process.rs
git commit -m "feat: resolve node path from directory"
```

## Task 5: Full Regression Verification

**Files:**
- Modify only if verification exposes a narrow bug in files already touched above

- [ ] **Step 1: Run frontend settings and semantic regression tests**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx tests/frontend/settings-store.test.ts tests/frontend/language-service-api.test.ts`

Expected: PASS.

- [ ] **Step 2: Run Rust semantic host tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml semantic_host`

Expected: PASS.

- [ ] **Step 3: Run full frontend test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit any narrow verification fixes**

If verification required fixes:

```bash
git add src/components/settings/SettingsDialog.tsx src/components/settings/settings-sections/SettingsSdkPanel.tsx src/components/layout/AppShell.tsx src-tauri/src/services/semantic_host/process.rs tests/frontend/app-shell.test.tsx
git commit -m "fix: stabilize settings apply flow"
```

If no fixes were needed, do not create an empty commit.
