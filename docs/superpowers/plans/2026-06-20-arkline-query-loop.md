# ArkLine Query Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first trustworthy IDE-style ArkTS query loop to ArkLine: `Ctrl+B` / `Ctrl+Click` for definition navigation and `Alt+F7` for usages, with a persistent bottom `Usages` panel.

**Architecture:** Extend the existing language-service-shaped frontend boundary instead of inventing a new semantic transport. Keep definition as a direct navigation action that reuses `openFile + selectionTarget + focusToken`, and model usages as persistent shell state rendered by a dedicated `UsagesPanel` in the bottom tool window.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, Vitest, Testing Library, existing Tauri-facing `workspace-api` abstraction

---

## File Structure

- Modify: `src/features/workspace/workspace-api.ts`
  - Add `UsageResult` type and `findUsages` API contract
  - Provide mock usage results for demo workspaces
- Modify: `src/components/layout/shell-state.ts`
  - Add `usages` bottom tool key
- Modify: `src/components/layout/shell-keymap.ts`
  - Add `Alt+F7` command mapping for usages
- Modify: `src/components/layout/app-shell-helpers.ts`
  - Add command-palette entry for `Find Usages`
- Modify: `src/components/layout/BottomToolWindow.tsx`
  - Render a new `Usages` tab and accept a `usagesPanel` prop
- Create: `src/components/layout/UsagesPanel.tsx`
  - Render loading, empty, error, and result-list states
- Create: `src/features/workspace/usage-search.ts`
  - Hold the `UsageSearchState` type and helpers in one focused file
- Modify: `src/components/layout/AppShell.tsx`
  - Wire usage query state, definition/usages commands, result navigation, and bottom tab selection
- Modify: `src/editor/ArkTsEditor.tsx`
  - Add a lightweight `Ctrl+Click` trigger callback
- Modify: `src/editor/LazyArkTsEditor.tsx`
  - Pass through the click-trigger callback
- Modify: `src/components/layout/EditorSurface.tsx`
  - Pass the click-trigger callback into the editor
- Modify: `tests/frontend/language-service-api.test.ts`
  - Cover `findUsages` mock behavior
- Modify: `tests/frontend/shell-hotkeys.test.tsx`
  - Cover `Alt+F7` shell command routing
- Modify: `tests/frontend/app-shell.test.tsx`
  - Cover usages rendering, click-through navigation, and definition click behavior
- Modify: `gitlog.md`
  - Record the completed query-loop milestone

## Task 1: Add Usage Search API And Mock Contract

**Files:**
- Create: `src/features/workspace/usage-search.ts`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/language-service-api.test.ts`

- [ ] **Step 1: Write the failing API test**

```ts
// tests/frontend/language-service-api.test.ts
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

describe("language service api", () => {
  const findUsages = defaultWorkspaceApi.findUsages!;

  it("returns mock usage results for the demo workspace", async () => {
    await expect(findUsages({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 1,
      column: 7,
    })).resolves.toEqual([
      {
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 1,
        column: 1,
        preview: "@Entry",
      },
      {
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 3,
        column: 8,
        preview: "struct Index {}",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- language-service-api
```

Expected: FAIL because `findUsages` does not exist on `WorkspaceApi` or the returned value does not match the assertion.

- [ ] **Step 3: Add shared usage-search types**

```ts
// src/features/workspace/usage-search.ts
export type UsageResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type UsageSearchState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  items: UsageResult[];
  requestedSymbol?: {
    path: string;
    line: number;
    column: number;
    symbolText?: string;
  };
  message?: string;
};

export function idleUsageSearchState(): UsageSearchState {
  return {
    status: "idle",
    items: [],
  };
}
```

- [ ] **Step 4: Add the API contract and mock implementation**

```ts
// src/features/workspace/workspace-api.ts
import type { UsageResult } from "@/features/workspace/usage-search";

export type WorkspaceApi = {
  // existing methods...
  findUsages?(request: LanguageQueryRequest): Promise<UsageResult[]>;
};

async findUsages(request) {
  if (hasTauriRuntime()) {
    return invoke<UsageResult[]>("find_usages", { request });
  }

  if (!isDemoWorkspacePath(request.path)) {
    return [];
  }

  return [
    {
      path: normalizePath(request.path),
      line: 1,
      column: 1,
      preview: "@Entry",
    },
    {
      path: normalizePath(request.path),
      line: 3,
      column: 8,
      preview: "struct Index {}",
    },
  ];
},
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm test -- language-service-api
```

Expected: PASS with the new usage-search assertion and the existing language-service API assertions.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/usage-search.ts src/features/workspace/workspace-api.ts tests/frontend/language-service-api.test.ts
git commit -m "feat: add usage search api contract"
```

## Task 2: Add Hotkeys, Bottom Tool State, And Usages Panel

**Files:**
- Modify: `src/components/layout/shell-state.ts`
- Modify: `src/components/layout/shell-keymap.ts`
- Modify: `src/components/layout/app-shell-helpers.ts`
- Modify: `src/components/layout/BottomToolWindow.tsx`
- Create: `src/components/layout/UsagesPanel.tsx`
- Test: `tests/frontend/shell-hotkeys.test.tsx`

- [ ] **Step 1: Write the failing hotkey and tab tests**

```ts
// tests/frontend/shell-hotkeys.test.tsx
it("opens the usages tool window with Alt+F7", async () => {
  const user = userEvent.setup();
  render(<AppShell />);

  await user.click(await openEditor(user));
  await user.keyboard("{Alt>}{F7}{/Alt}");

  expect(await screen.findByRole("tab", { name: "Usages" })).toHaveAttribute("aria-selected", "true");
});
```

```ts
// tests/frontend/app-shell.test.tsx
expect(screen.getByRole("tab", { name: "Usages" })).toBeInTheDocument();
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test -- shell-hotkeys app-shell
```

Expected: FAIL because `Alt+F7` does not map to a shell command and the bottom tool window has no `Usages` tab.

- [ ] **Step 3: Add state and keymap support**

```ts
// src/components/layout/shell-state.ts
export type BottomToolKey = "problems" | "terminal" | "git" | "usages";
```

```ts
// src/components/layout/shell-keymap.ts
export type ShellCommand =
  | "findUsages"
  // existing commands...

if (event.altKey && key === "f7" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
  return "findUsages";
}
```

```ts
// src/components/layout/app-shell-helpers.ts
{ id: "find-usages", label: "Find Usages", action: actions.findUsages }
```

- [ ] **Step 4: Add the new tab and a focused usages panel**

```tsx
// src/components/layout/UsagesPanel.tsx
import type { UsageSearchState, UsageResult } from "@/features/workspace/usage-search";

type UsagesPanelProps = {
  state: UsageSearchState;
  onOpenUsage: (item: UsageResult) => void;
};

export function UsagesPanel({ state, onOpenUsage }: UsagesPanelProps) {
  if (state.status === "loading") {
    return <div aria-label="Usages Panel">Finding usages...</div>;
  }

  if (state.status === "error") {
    return <div aria-label="Usages Panel">{state.message ?? "Usage query failed"}</div>;
  }

  if (state.status === "empty") {
    return <div aria-label="Usages Panel">No usages found</div>;
  }

  return (
    <div aria-label="Usages Panel">
      {state.items.map((item) => (
        <button
          key={`${item.path}:${item.line}:${item.column}`}
          type="button"
          onClick={() => onOpenUsage(item)}
        >
          {item.path}
          <span>{item.line}:{item.column}</span>
          <span>{item.preview}</span>
        </button>
      ))}
    </div>
  );
}
```

```tsx
// src/components/layout/BottomToolWindow.tsx
type BottomToolWindowProps = {
  // existing props...
  usagesPanel: ReactNode;
};

<button role="tab" aria-selected={activeTool === "usages"}>Usages</button>

{activeTool === "usages" ? usagesPanel : null}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm test -- shell-hotkeys app-shell
```

Expected: PASS for the new `Alt+F7` and `Usages` tab assertions, with existing shell tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/shell-state.ts src/components/layout/shell-keymap.ts src/components/layout/app-shell-helpers.ts src/components/layout/BottomToolWindow.tsx src/components/layout/UsagesPanel.tsx tests/frontend/shell-hotkeys.test.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add usages tool window shell wiring"
```

## Task 3: Wire Find Usages Through App Shell State

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing usage-query and result-navigation tests**

```ts
// tests/frontend/app-shell.test.tsx
it("finds usages from the editor and opens the usages panel", async () => {
  const user = userEvent.setup();
  const workspaceApi: WorkspaceApi = {
    // existing stubs...
    findUsages: vi.fn(async () => [
      {
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 8,
        preview: "struct Index {}",
      },
    ]),
  };

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.keyboard("{Alt>}{F7}{/Alt}");

  expect(await screen.findByRole("tab", { name: "Usages" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("button", { name: /struct Index/ })).toBeVisible();
});

it("opens a usage result in the editor", async () => {
  const user = userEvent.setup();
  render(<AppShell workspaceApi={workspaceApiWithUsages} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.keyboard("{Alt>}{F7}{/Alt}");
  await user.click(await screen.findByRole("button", { name: /struct Index/ }));

  expect(await screen.findByLabelText("Editor Content")).toHaveFocus();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- app-shell
```

Expected: FAIL because `AppShell` does not hold usage-search state, does not run `findUsages`, and does not mount a `UsagesPanel`.

- [ ] **Step 3: Add usage-search state and command handlers**

```ts
// src/components/layout/AppShell.tsx
import { idleUsageSearchState, type UsageResult } from "@/features/workspace/usage-search";

const [usageSearch, setUsageSearch] = useState(idleUsageSearchState());

async function findUsagesFromEditor() {
  if (!activePath || !workspaceApi.findUsages) {
    setUsageSearch({ status: "error", items: [], message: "Language service unavailable" });
    setBottomVisible(true);
    setActiveBottomTool("usages");
    setStatusText("Language service unavailable");
    return;
  }

  setUsageSearch({
    status: "loading",
    items: [],
    requestedSymbol: { path: activePath, line: editorSelection.line, column: editorSelection.column },
  });
  setBottomVisible(true);
  setActiveBottomTool("usages");
  setStatusText("Finding usages...");

  const items = await workspaceApi.findUsages({
    path: activePath,
    line: editorSelection.line,
    column: editorSelection.column,
  });

  setUsageSearch(items.length > 0
    ? { status: "ready", items }
    : { status: "empty", items: [] });
  setStatusText(items.length > 0 ? `Usages: ${items.length} results` : "No usages found");
}

function openUsageResult(item: UsageResult) {
  void openFile(item.path).then(() => {
    setSelectionTarget({ line: item.line, column: item.column, nonce: Date.now() });
    setEditorFocusToken((token) => token + 1);
    focusEditorSoon();
  });
}
```

- [ ] **Step 4: Mount the usages panel and command routing**

```tsx
// src/components/layout/AppShell.tsx
useShellHotkeys({
  onCommand(command) {
    const handlers: Partial<Record<ShellCommand, () => void>> = {
      findUsages: () => void findUsagesFromEditor(),
      // existing handlers...
    };
    // existing dispatch...
  },
});

const commandPaletteItems = buildAppShellCommandPaletteItems(quickOpenQuery, {
  findUsages: () => void findUsagesFromEditor(),
  // existing actions...
});

<BottomToolWindow
  // existing props...
  usagesPanel={<UsagesPanel state={usageSearch} onOpenUsage={openUsageResult} />}
/>
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm test -- app-shell
```

Expected: PASS for usages-panel rendering, empty state, unavailable-provider state, and click-through navigation without breaking existing editor and shell regressions.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/layout/UsagesPanel.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add usages query loop"
```

## Task 4: Add Ctrl+Click Definition Trigger And Final Verification

**Files:**
- Modify: `src/editor/ArkTsEditor.tsx`
- Modify: `src/editor/LazyArkTsEditor.tsx`
- Modify: `src/components/layout/EditorSurface.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`
- Modify: `gitlog.md`

- [ ] **Step 1: Write the failing click-definition test**

```ts
// tests/frontend/app-shell.test.tsx
it("runs definition navigation from ctrl-click", async () => {
  const user = userEvent.setup();
  const workspaceApi: WorkspaceApi = {
    // existing stubs...
    gotoDefinition: vi.fn(async () => ({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 3,
      column: 1,
    })),
  };

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  const editor = await screen.findByLabelText("Editor Content");
  await user.pointer([{ target: editor, keys: "[MouseLeft>][ControlLeft>]" }, { keys: "[/MouseLeft][/ControlLeft]" }]);

  await waitFor(() => expect(workspaceApi.gotoDefinition).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- app-shell
```

Expected: FAIL because the editor does not expose a `Ctrl+Click` definition trigger callback.

- [ ] **Step 3: Add a lightweight editor click callback**

```ts
// src/editor/ArkTsEditor.tsx
type ArkTsEditorProps = {
  // existing props...
  onPrimaryModifiedClick?: () => void;
};

useEffect(() => {
  const view = viewRef.current;
  if (!view) {
    return;
  }

  function handleMouseDown(event: MouseEvent) {
    if ((event.ctrlKey || event.metaKey) && event.button === 0) {
      onPrimaryModifiedClick?.();
    }
  }

  view.dom.addEventListener("mousedown", handleMouseDown);
  return () => view.dom.removeEventListener("mousedown", handleMouseDown);
}, [onPrimaryModifiedClick]);
```

```tsx
// src/components/layout/EditorSurface.tsx
type EditorSurfaceProps = {
  // existing props...
  onPrimaryModifiedClick: () => void;
};

<LazyArkTsEditor
  // existing props...
  onPrimaryModifiedClick={onPrimaryModifiedClick}
/>
```

```tsx
// src/components/layout/AppShell.tsx
<EditorSurface
  // existing props...
  onPrimaryModifiedClick={() => void goToDefinitionFromEditor()}
/>
```

- [ ] **Step 4: Run the full verification set**

Run:

```bash
pnpm test -- app-shell
pnpm test -- language-service-api shell-hotkeys
pnpm build
wc -l src/components/layout/AppShell.tsx
```

Expected:

- app-shell tests: PASS
- language-service and shell-hotkey tests: PASS
- build: PASS
- `AppShell.tsx` line count: `< 500`

- [ ] **Step 5: Update the changelog**

```md
// gitlog.md
- 2026-06-20: Added the first IDE-style query loop with `Ctrl+B`, `Ctrl+Click`, `Alt+F7`, and a bottom `Usages` tool window backed by the shared language-service API contract.
```

- [ ] **Step 6: Commit**

```bash
git add src/editor/ArkTsEditor.tsx src/editor/LazyArkTsEditor.tsx src/components/layout/EditorSurface.tsx src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx gitlog.md
git commit -m "feat: add definition click trigger"
```

## Self-Review

- Spec coverage check:
  - `Ctrl+Click` / `Ctrl+B` definition flow: Task 4
  - `Alt+F7` usages flow: Tasks 2 and 3
  - bottom `Usages` tool window: Tasks 2 and 3
  - result click-through navigation: Task 3
  - mock-provider compatibility: Task 1
  - `AppShell.tsx` line-count guardrail and final verification: Task 4
- Placeholder scan:
  - no `TODO`, `TBD`, or undefined follow-up steps remain in execution tasks
- Type consistency:
  - `UsageResult`, `UsageSearchState`, `findUsages`, and `findUsagesFromEditor` names are consistent across tasks

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-arkline-query-loop.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
