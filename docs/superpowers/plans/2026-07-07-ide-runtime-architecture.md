# IDE Runtime Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild ArkLine's interaction runtime around a six-layer IDE architecture so typing, file opening, search, indexing, logs, and navigation remain responsive on medium and large projects.

**Architecture:** The work separates UI shell state, editor/document runtime, command sessions, backend services, index/language services, and observability. The first milestone is not a visual redesign; it is a latency-control foundation that prevents high-frequency events from repainting the whole workbench or blocking Tauri IPC.

**Tech Stack:** React, CodeMirror 6, Tauri, Rust, SQLite/FTS5, ArkLine workspace index services, ArkTS semantic worker.

---

## Six-Layer Target

1. **UI Shell Layer**
   - Owns layout, visible panels, menus, status bar summaries, and modal visibility only.
   - Must not own full file text, large search results, log buffers, or raw index events.

2. **Editor Runtime Layer**
   - CodeMirror and a document runtime store own open buffers.
   - React subscribes only to small projections: `activePath`, dirty flag, title, cursor summary, and readiness.

3. **Command Session Layer**
   - Search, completion, quick open, find usages, definition, current file symbols, build, and log queries each run as explicit sessions.
   - A session owns input state, debounce, generation id, cancel token, result slices, and stale-response handling.

4. **Backend Service Layer**
   - Tauri commands are async at the command boundary.
   - Disk, git, language service, search, index, and build work uses `spawn_blocking` or a dedicated worker/pool.
   - Commands return small projections first; large payloads are paged or streamed.

5. **Index / Language Layer**
   - Four index layers remain: file, symbol/stub, content/text, SDK/API.
   - Query facades choose the correct layer and fallback policy.
   - Long-term semantic features route through a language-service client rather than direct UI calls.

6. **Observability Layer**
   - Tracks event-loop lag, React render pressure, IPC latency, command queue pressure, search generation lifecycle, index worker pressure, and file-open latency.
   - Diagnostics are always cheap in the status bar and detailed only when a diagnostic panel is open.

## Critical Rules

- Keyboard input must never wait for search, indexing, preview loading, logs, or diagnostics.
- Editor scroll and typing must remain usable while indexing is running.
- Background work must be cancellable, generation-checked, and observable.
- Search can return late or partial results; the input field must stay responsive.
- Large payloads must not be placed in `AppShell` state.
- High-frequency backend events must be projected and throttled before touching React state.
- Every touched code file must stay at or below 500 lines.

## Phase Roadmap

### Phase 0: Stabilize Current Worktree

**Purpose:** Separate the already-applied local performance fixes from the long-term architecture work.

**Files:**
- Verify: `src/editor/ArkTsEditor.tsx`
- Verify: `src/editor/editor-events.ts`
- Verify: `src/editor/editor-extensions.ts`
- Verify: `src/components/layout/query-input-props.ts`
- Verify: `src/components/layout/SearchOverlayContent.tsx`
- Verify: `src/components/layout/SearchEverywherePanel.tsx`
- Verify: `src/components/layout/use-search-everywhere-controller.ts`

- [ ] **Step 1: Review current diff**

Run:

```bash
git status --short
git diff --stat
```

Expected:

- Editor scroll optimization files are visible.
- Query input hint files are visible.
- Search debounce and irrelevant-computation pruning files are visible.
- No unrelated generated files are staged.

- [ ] **Step 2: Run baseline verification**

Run:

```bash
pnpm build
git diff --check
wc -l src/editor/ArkTsEditor.tsx src/editor/editor-events.ts src/editor/editor-extensions.ts src/components/layout/SearchEverywherePanel.tsx src/components/layout/use-search-everywhere-controller.ts
```

Expected:

- `pnpm build` exits successfully.
- `git diff --check` prints no errors.
- Each listed file is `500` lines or fewer.

- [ ] **Step 3: Commit current stopgap fixes before large refactor**

Run:

```bash
git add src/editor/ArkTsEditor.tsx src/editor/editor-events.ts src/editor/editor-extensions.ts src/components/layout/query-input-props.ts src/components/layout/SearchOverlayContent.tsx src/components/layout/SearchEverywherePanel.tsx src/components/layout/CurrentClassMethodsPalette.tsx src/components/layout/DeviceLogFilterBar.tsx src/components/layout/DeviceFaultLogPanel.tsx src/components/layout/app-shell-derived-state.ts src/components/layout/use-app-shell-commands.ts src/components/layout/use-search-everywhere-controller.ts
git commit -m "Improve editor and search responsiveness"
```

Expected:

- Commit succeeds.
- The architecture refactor starts from a clean baseline.

### Phase 1: Observability and Render Pressure

**Purpose:** Stop guessing. Add cheap instrumentation that identifies which UI updates, IPC calls, and backend events produce visible stalls.

**Files:**
- Create: `src/features/performance/render-pressure-store.ts`
- Create: `src/features/performance/ipc-latency-store.ts`
- Modify: `src/features/workspace/workspace-api-runtime.ts`
- Modify: `src/features/performance/ui-latency-monitor.ts`
- Modify: `src/features/performance/use-ui-latency-monitor.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`

- [ ] **Step 1: Add render pressure store**

Create `src/features/performance/render-pressure-store.ts`:

```ts
export type RenderPressureSample = {
  label: string;
  count: number;
  lastRenderedAt: number;
};

export function createRenderPressureStore(limit = 40) {
  const samples = new Map<string, RenderPressureSample>();

  return {
    record(label: string, now = Date.now()) {
      const current = samples.get(label);
      samples.set(label, {
        label,
        count: (current?.count ?? 0) + 1,
        lastRenderedAt: now,
      });
      while (samples.size > limit) {
        const first = samples.keys().next().value;
        if (!first) break;
        samples.delete(first);
      }
    },
    snapshot() {
      return [...samples.values()].sort((left, right) => right.lastRenderedAt - left.lastRenderedAt);
    },
  };
}
```

- [ ] **Step 2: Add IPC latency store**

Create `src/features/performance/ipc-latency-store.ts`:

```ts
export type IpcLatencySample = {
  command: string;
  durationMs: number;
  startedAt: number;
  status: "ok" | "error";
};

export function createIpcLatencyStore(limit = 80) {
  const samples: IpcLatencySample[] = [];

  return {
    record(sample: IpcLatencySample) {
      samples.push(sample);
      while (samples.length > limit) samples.shift();
    },
    snapshot() {
      return [...samples].sort((left, right) => right.startedAt - left.startedAt);
    },
  };
}
```

- [ ] **Step 3: Wrap Tauri invoke timing**

Modify `src/features/workspace/workspace-api-runtime.ts` so every `invoke` records duration.

Implementation shape:

```ts
import { createIpcLatencyStore } from "@/features/performance/ipc-latency-store";

const ipcLatencyStore = createIpcLatencyStore();

export function getIpcLatencySnapshot() {
  return ipcLatencyStore.snapshot();
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await tauriInvoke<T>(command, args);
    ipcLatencyStore.record({ command, durationMs: Date.now() - startedAt, startedAt, status: "ok" });
    return result;
  } catch (error) {
    ipcLatencyStore.record({ command, durationMs: Date.now() - startedAt, startedAt, status: "error" });
    throw error;
  }
}
```

Use the current file's existing import names instead of inventing a second Tauri invoke binding.

- [ ] **Step 4: Extend latency snapshot type**

Modify `src/features/performance/ui-latency-monitor.ts`:

```ts
import type { IpcLatencySample } from "@/features/performance/ipc-latency-store";
import type { RenderPressureSample } from "@/features/performance/render-pressure-store";

export type UiLatencySnapshot = {
  eventLoopLags: UiLatencySample[];
  interactions: UiLatencySample[];
  ipc: IpcLatencySample[];
  renders: RenderPressureSample[];
};
```

Keep existing event-loop and interaction behavior unchanged.

- [ ] **Step 5: Expose combined diagnostics hook**

Modify `src/features/performance/use-ui-latency-monitor.ts` to include:

```ts
import { getIpcLatencySnapshot } from "@/features/workspace/workspace-api-runtime";
import { createRenderPressureStore } from "@/features/performance/render-pressure-store";

const renderPressureStore = createRenderPressureStore();

export function recordRenderPressure(label: string) {
  renderPressureStore.record(label);
}
```

When refreshing samples, merge:

```ts
[
  ...snapshot.eventLoopLags,
  ...snapshot.interactions,
]
```

and expose separate `ipcLatencySamples` and `renderPressureSamples` from the hook.

- [ ] **Step 6: Record AppShell render pressure**

Modify `src/components/layout/AppShell.tsx`:

```ts
import { recordRenderPressure } from "@/features/performance/use-ui-latency-monitor";
```

Inside `AppShell`:

```ts
recordRenderPressure("AppShell");
```

Expected:

- This is cheap and records one counter per render.
- It does not call `setState`.

- [ ] **Step 7: Surface diagnostics**

Modify `src/components/layout/IndexDiagnosticsCenter.tsx` to show:

- Recent IPC command durations.
- Recent render pressure samples.
- Existing event-loop lag samples.

The panel must only render detailed lists when already open; status bar remains summary-only.

- [ ] **Step 8: Verify Phase 1**

Run:

```bash
pnpm build
git diff --check
wc -l src/features/performance/render-pressure-store.ts src/features/performance/ipc-latency-store.ts src/features/workspace/workspace-api-runtime.ts src/features/performance/ui-latency-monitor.ts src/features/performance/use-ui-latency-monitor.ts src/components/layout/AppShell.tsx src/components/layout/IndexDiagnosticsCenter.tsx
```

Expected:

- Build passes.
- Diff check passes.
- Every listed file is `500` lines or fewer.

- [ ] **Step 9: Commit Phase 1**

Run:

```bash
git add src/features/performance/render-pressure-store.ts src/features/performance/ipc-latency-store.ts src/features/workspace/workspace-api-runtime.ts src/features/performance/ui-latency-monitor.ts src/features/performance/use-ui-latency-monitor.ts src/components/layout/AppShell.tsx src/components/layout/IndexDiagnosticsCenter.tsx
git commit -m "Add IDE runtime latency diagnostics"
```

### Phase 2: Search Session Isolation

**Purpose:** Make query input local and cheap. Global state receives committed query sessions only after debounce.

**Files:**
- Create: `src/features/search/search-session-store.ts`
- Create: `src/components/layout/use-search-session-input.ts`
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Modify: `src/components/layout/SearchEverywherePanel.tsx`
- Modify: `src/components/layout/SearchOverlayContent.tsx`
- Modify: `src/components/layout/use-shell-layout-state.ts`

Execution requirements:

- Remove shared `quickOpenQuery` from Search Everywhere text input.
- Keep Quick Open, Command Palette, Recent Files, and Go To Line behavior intact.
- Each search mode owns `draftQuery`, `committedQuery`, `generation`, `status`, `results`, and `selectedIndex`.
- Text search result previews load only for the selected item and only after the main result settles.
- Stale generations must be ignored without pushing state to AppShell.

Verification:

```bash
pnpm build
git diff --check
```

Manual smoke:

- Open Double Shift, type 20 characters quickly, delete them quickly, close panel immediately.
- Open Ctrl+Shift+F, type quickly, close panel immediately.
- No visible lockup should occur; if lockup remains, use Phase 1 diagnostics to identify whether render, IPC, or backend search dominates.

### Phase 3: Editor Runtime Isolation

**Purpose:** Stop full document text from driving root React renders.

**Files:**
- Create: `src/features/documents/document-runtime-store.ts`
- Create: `src/components/layout/use-active-document-projection.ts`
- Modify: `src/components/layout/use-editor-documents.ts`
- Modify: `src/components/layout/use-editor-surface-controller.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/EditorSurface.tsx`
- Modify: `src/editor/ArkTsEditor.tsx`

Execution requirements:

- Keep full text in document runtime store.
- AppShell subscribes only to active document projection:
  - `activePath`
  - `title`
  - `isDirty`
  - `version`
  - `line`
  - `column`
  - `selectedText`
- CodeMirror update listener writes to document runtime store without calling root `setEditorContent` per keystroke.
- Consumers that need content call `getActiveContent()` lazily.
- Large file lightweight mode remains active.

Verification:

```bash
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml commands::workspace_tests
git diff --check
```

Manual smoke:

- Type in a medium file while search panel is closed.
- Open Search Everywhere while editing.
- Switch between five files quickly.
- Phase 1 render pressure should show far fewer AppShell renders during typing.

### Phase 4: Async Backend Command Boundary

**Purpose:** No disk, git, language-service, or validation command should block a Tauri command thread directly.

**Files:**
- Create: `src-tauri/src/services/document_command_service.rs`
- Create: `src-tauri/src/services/language_command_service.rs`
- Create: `src-tauri/src/services/git_command_service.rs`
- Modify: `src-tauri/src/commands/documents.rs`
- Modify: `src-tauri/src/commands/language.rs`
- Modify: `src-tauri/src/commands/git_trace.rs`
- Modify: `src-tauri/src/lib.rs`

Execution requirements:

- `open_text_document`, `save_text_document`, and `validate_text_document` become async commands.
- `hover_symbol`, `goto_definition`, `complete_symbol`, `document_symbols`, and `find_usages` become async commands.
- `get_file_blame` and `get_commit_trace` become async commands.
- Heavy implementations use `tauri::async_runtime::spawn_blocking`.
- Return types and frontend API remain unchanged.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::workspace_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
pnpm build
git diff --check
```

### Phase 5: Index Event Projection

**Purpose:** Background index events should not repaint the whole shell.

**Files:**
- Create: `src/features/workspace/workspace-index-projection-store.ts`
- Modify: `src/components/layout/use-workspace-index-watchers.ts`
- Modify: `src/components/layout/use-index-diagnostics-controller.ts`
- Modify: `src/components/layout/ShellStatusBar.tsx`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`

Execution requirements:

- Watchers update a projection store at most once every `500ms` for summary UI.
- Detailed event lists are kept for diagnostics only.
- Current file readiness remains a high-priority path but is generation-checked.
- Status bar receives a small immutable summary object, not raw task/event lists.

Verification:

```bash
pnpm build
git diff --check
```

Manual smoke:

- Open a medium project and watch indexing.
- Search and edit while index is running.
- Status bar should update, but input should not pause.

### Phase 6: Query Facade and Result Paging

**Purpose:** Search and symbol results should be paged and session-scoped, not pushed as large arrays through AppShell.

**Files:**
- Create: `src/features/search/search-result-window.ts`
- Modify: `src/components/layout/SearchEverywherePanel.tsx`
- Modify: `src/components/layout/SearchResultItems.tsx`
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Modify: `src-tauri/src/services/workspace_index_facade_search_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`

Execution requirements:

- Query returns first result page plus `nextCursor`.
- UI renders visible result windows.
- Preview loads separately.
- Keyboard navigation can request the next result page.
- Old full-array behavior remains behind adapter functions until tests are updated.

Verification:

```bash
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
git diff --check
```

### Phase 7: Language Service Client Boundary

**Purpose:** Completion, definition, usages, document symbols, and hover use a single language-service client with timeout, cancellation, stale-response discard, and readiness reporting.

**Files:**
- Create: `src/features/language/language-session-store.ts`
- Create: `src-tauri/src/services/language_client_runtime_service.rs`
- Modify: `src/components/layout/use-completion-controller.ts`
- Modify: `src/components/layout/use-definition-controller.ts`
- Modify: `src/components/layout/use-usages-controller.ts`
- Modify: `src/components/layout/use-current-file-symbols-controller.ts`
- Modify: `src-tauri/src/commands/language.rs`

Execution requirements:

- Every language request has `requestId`, `generation`, `timeoutMs`, and `source`.
- Completion typing requests are cancellable and stale responses do not update UI.
- Definition requests can wait for current-file readiness but never block editor input.
- Current file symbols use the same client path as `Ctrl+F12`.

Verification:

```bash
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_completion_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests
git diff --check
```

### Phase 8: Performance Gate and Release Criteria

**Purpose:** Every release must prove the IDE remains usable under load.

**Files:**
- Create: `docs/performance-runtime-gate.md`
- Create: `scripts/perf-search-input.mjs`
- Create: `scripts/perf-file-switch.mjs`
- Modify: `docs/performance-baseline.md`
- Modify: `.github/workflows` release workflow if a suitable CI smoke target exists.

Required scenarios:

- Open 5k, 20k, and 100k file fixture projects.
- Type/delete 100 characters in Search Everywhere.
- Type/delete 100 characters in Ctrl+Shift+F.
- Switch 50 files.
- Scroll one large source file.
- Run indexing while editing.
- Stream logs while searching.

Release targets:

- Search input visible response p95 <= `50ms`.
- File switch first paint p95 <= `300ms`.
- AppShell render count does not grow per editor keystroke.
- IPC commands over `100ms` appear in diagnostics.
- UI long tasks over `100ms` appear in diagnostics with timestamp and category.

## Execution Order

1. Finish Phase 0 immediately to freeze the stopgap fixes.
2. Execute Phase 1 before any further performance claims.
3. Execute Phase 2 and Phase 3 before publishing another "responsiveness fixed" release.
4. Execute Phase 4 before adding new language/search features.
5. Execute Phase 5 through Phase 8 as the durable IDE runtime foundation.

## Self-Review

- Spec coverage: The plan covers all six layers and maps them to concrete phases.
- Placeholder scan: No `TBD` or `TODO` markers are present.
- Type consistency: Shared names use `renderPressure`, `ipcLatency`, `searchSession`, `documentRuntime`, and `indexProjection` consistently.
- Scope check: The plan is intentionally multi-phase. Phase 1 is the first independently shippable slice.
