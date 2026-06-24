# ArkLine IDE Completion Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ArkLine's command-palette-style completion overlay with an editor-anchored IDE completion popup while keeping deterministic language-service completion stable and reserving a future ghost-text lane.

**Architecture:** Add a focused completion model/controller/popup trio and wire it through `AppShell`, `EditorSurface`, `LazyArkTsEditor`, and `ArkTsEditor`. Keep Quick Open, Search Everywhere, Command Palette, Recent Files, and Go To Line on the existing overlay system. Use CodeMirror coordinates for caret anchoring, with a stable editor-local fallback in tests.

**Tech Stack:** React, TypeScript, CodeMirror 6, Vitest, Testing Library, existing ArkLine workspace API and CSS.

---

## File Structure

- Create: `src/components/layout/completion-model.ts`
  - Normalizes backend `LanguageCompletionItem` values into UI-ready completion items.
  - Owns deterministic ranking, source labels, kind labels, and future surface types.
- Create: `src/components/layout/use-completion-controller.ts`
  - Owns completion request lifecycle, debounce, stale-response filtering, cooldown for repeated automatic empty results, selected index, details visibility, and accept/close actions.
- Create: `src/components/layout/CompletionPopup.tsx`
  - Pure popup UI. It does not call the workspace API and does not modify editor state directly.
- Modify: `src/editor/editor-events.ts`
  - Export caret rectangle helper and refine typing-trigger character detection.
- Modify: `src/editor/ArkTsEditor.tsx`
  - Expose caret rectangle changes to React and keep editor-focused key handling available.
- Modify: `src/editor/LazyArkTsEditor.tsx`
  - Pass new caret rectangle callback through lazy boundary.
- Modify: `src/components/layout/EditorSurface.tsx`
  - Render `CompletionPopup` inside editor surface and pass editor-local anchor information.
- Modify: `src/components/layout/AppShell.tsx`
  - Remove completion from `activeOverlay`, use `useCompletionController`, and keep settings/applying gates.
- Modify: `src/components/layout/SearchOverlayContent.tsx`
  - Remove the `activeOverlay === "completion"` branch after AppShell stops using it.
- Modify: `src/components/layout/search-overlay-model.ts`
  - Remove `"completion"` from overlay label handling after migration.
- Modify: `src/components/layout/shell-state.ts`
  - Remove `"completion"` from `OverlayKey`.
- Modify: `src/styles/app.css`
  - Add restrained IDE popup styling.
- Modify: `tests/frontend/app-shell.test.tsx`
  - Update existing completion tests from `Completion Overlay` / `Completion Query` to `Code Completion` popup behavior.
- Create: `tests/frontend/completion-model.test.ts`
  - Unit tests for normalization and ranking.

---

## Task 1: Completion Model and Ranking

**Files:**
- Create: `src/components/layout/completion-model.ts`
- Test: `tests/frontend/completion-model.test.ts`

- [ ] **Step 1: Write failing model tests**

Create `tests/frontend/completion-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeCompletionItems,
  rankCompletionItems,
  type CompletionContext,
  type CompletionPresentation,
} from "@/components/layout/completion-model";
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";

function labels(items: CompletionPresentation[]) {
  return items.map((item) => item.label);
}

describe("completion model", () => {
  it("normalizes backend items into source-aware presentation items", () => {
    const backendItems: LanguageCompletionItem[] = [
      { label: "width", detail: "ArkUI modifier", kind: "property" },
      { label: "build()", detail: "Component lifecycle method", kind: "method" },
    ];

    expect(normalizeCompletionItems(backendItems, {
      prefix: "wi",
      lineTextBeforeCursor: "Column().wi",
      trigger: "typing",
    })).toEqual([
      expect.objectContaining({
        label: "width",
        kind: "property",
        source: "arkuiSdk",
        sourceLabel: "ArkUI SDK",
        replacementPrefix: "wi",
      }),
      expect.objectContaining({
        label: "build()",
        kind: "method",
        source: "workspace",
        sourceLabel: "Workspace",
        replacementPrefix: "wi",
      }),
    ]);
  });

  it("ranks prefix matches before contains matches and recency tie-breaks only close items", () => {
    const context: CompletionContext = {
      prefix: "bu",
      lineTextBeforeCursor: "struct Index { bu",
      trigger: "typing",
      acceptedLabels: new Map([["button()", 5]]),
    };
    const items = normalizeCompletionItems([
      { label: "build()", detail: "Lifecycle", kind: "method" },
      { label: "debugBuild()", detail: "Helper", kind: "function" },
      { label: "button()", detail: "Factory", kind: "function" },
    ], context);

    expect(labels(rankCompletionItems(items, context))).toEqual([
      "build()",
      "button()",
      "debugBuild()",
    ]);
  });

  it("prioritizes ArkUI chain modifiers after component calls", () => {
    const context: CompletionContext = {
      prefix: "w",
      lineTextBeforeCursor: "Column().w",
      trigger: "typing",
      acceptedLabels: new Map([["workspaceHelper", 100]]),
    };
    const items = normalizeCompletionItems([
      { label: "workspaceHelper", detail: "Workspace symbol", kind: "function" },
      { label: "width", detail: "ArkUI modifier", kind: "property" },
      { label: "wrapBuilder", detail: "Utility", kind: "function" },
    ], context);

    expect(labels(rankCompletionItems(items, context))).toEqual([
      "width",
      "workspaceHelper",
      "wrapBuilder",
    ]);
  });
});
```

- [ ] **Step 2: Run model tests and verify failure**

Run:

```bash
pnpm exec vitest run tests/frontend/completion-model.test.ts
```

Expected: FAIL because `src/components/layout/completion-model.ts` does not exist.

- [ ] **Step 3: Implement completion model**

Create `src/components/layout/completion-model.ts`:

```ts
import type { LanguageCompletionItem } from "@/features/workspace/workspace-api";

export type CompletionSurface = "suggestionList" | "inlineGhostText";
export type CompletionTrigger = "manual" | "typing";

export type CompletionSource =
  | "arkuiSdk"
  | "workspace"
  | "currentFile"
  | "snippet"
  | "fallback"
  | "unknown";

export type CompletionItemKind =
  | "method"
  | "property"
  | "class"
  | "struct"
  | "component"
  | "snippet"
  | "keyword"
  | "text"
  | "unknown";

export type CompletionContext = {
  prefix: string;
  lineTextBeforeCursor: string;
  trigger: CompletionTrigger;
  acceptedLabels?: Map<string, number>;
};

export type CompletionPresentation = {
  id: string;
  label: string;
  insertText: string;
  detail: string;
  documentation?: string;
  kind: CompletionItemKind;
  kindLabel: string;
  source: CompletionSource;
  sourceLabel: string;
  replacementPrefix: string;
  original: LanguageCompletionItem;
};

const KIND_LABELS: Record<CompletionItemKind, string> = {
  method: "Method",
  property: "Property",
  class: "Class",
  struct: "Struct",
  component: "Component",
  snippet: "Snippet",
  keyword: "Keyword",
  text: "Text",
  unknown: "Symbol",
};

const SOURCE_LABELS: Record<CompletionSource, string> = {
  arkuiSdk: "ArkUI SDK",
  workspace: "Workspace",
  currentFile: "Current file",
  snippet: "Snippet",
  fallback: "Fallback",
  unknown: "Unknown",
};

function normalizeKind(kind: string): CompletionItemKind {
  const lower = kind.toLowerCase();
  if (lower === "function") return "method";
  if (lower in KIND_LABELS) return lower as CompletionItemKind;
  return "unknown";
}

function inferSource(item: LanguageCompletionItem, kind: CompletionItemKind, context: CompletionContext): CompletionSource {
  const detail = item.detail.toLowerCase();
  const label = item.label.toLowerCase();
  const afterArkUiChain = /\b[A-Z][A-Za-z0-9_]*\(\)\.[A-Za-z0-9_$]*$/.test(context.lineTextBeforeCursor);
  if (detail.includes("arkui") || (afterArkUiChain && kind === "property")) return "arkuiSdk";
  if (kind === "snippet") return "snippet";
  if (detail.includes("fallback")) return "fallback";
  if (detail.includes("current file") || label.startsWith("@")) return "currentFile";
  return "workspace";
}

export function normalizeCompletionItems(items: LanguageCompletionItem[], context: CompletionContext): CompletionPresentation[] {
  return items.map((item, index) => {
    const kind = normalizeKind(item.kind);
    const source = inferSource(item, kind, context);
    return {
      id: `${item.kind}:${item.label}:${index}`,
      label: item.label,
      insertText: item.label,
      detail: item.detail,
      kind,
      kindLabel: KIND_LABELS[kind],
      source,
      sourceLabel: SOURCE_LABELS[source],
      replacementPrefix: context.prefix,
      original: item,
    };
  });
}

function matchScore(label: string, prefix: string) {
  const normalizedLabel = label.toLowerCase();
  const normalizedPrefix = prefix.toLowerCase();
  if (!normalizedPrefix) return 0;
  if (label.startsWith(prefix)) return 0;
  if (normalizedLabel.startsWith(normalizedPrefix)) return 1;
  if (new RegExp(normalizedPrefix.split("").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[A-Za-z0-9_]*")).test(label)) return 2;
  const containsIndex = normalizedLabel.indexOf(normalizedPrefix);
  return containsIndex >= 0 ? 3 + containsIndex : 1000;
}

function sourceScore(item: CompletionPresentation, context: CompletionContext) {
  const afterArkUiChain = /\b[A-Z][A-Za-z0-9_]*\(\)\.[A-Za-z0-9_$]*$/.test(context.lineTextBeforeCursor);
  if (afterArkUiChain && item.source === "arkuiSdk") return 0;
  if (item.source === "currentFile") return 1;
  if (item.source === "workspace") return 2;
  if (item.source === "snippet") return 3;
  if (item.source === "fallback") return 4;
  return 5;
}

function kindScore(kind: CompletionItemKind) {
  if (kind === "property") return 0;
  if (kind === "method") return 1;
  if (kind === "component" || kind === "class" || kind === "struct") return 2;
  if (kind === "keyword") return 3;
  if (kind === "snippet") return 4;
  return 5;
}

export function rankCompletionItems(items: CompletionPresentation[], context: CompletionContext) {
  return [...items].sort((left, right) => {
    const leftMatch = matchScore(left.label, context.prefix);
    const rightMatch = matchScore(right.label, context.prefix);
    const leftRecent = -(context.acceptedLabels?.get(left.label) ?? 0);
    const rightRecent = -(context.acceptedLabels?.get(right.label) ?? 0);
    return leftMatch - rightMatch
      || sourceScore(left, context) - sourceScore(right, context)
      || leftRecent - rightRecent
      || kindScore(left.kind) - kindScore(right.kind)
      || left.label.localeCompare(right.label);
  });
}
```

- [ ] **Step 4: Run model tests and verify pass**

Run:

```bash
pnpm exec vitest run tests/frontend/completion-model.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/completion-model.ts tests/frontend/completion-model.test.ts
git commit -m "feat: add completion ranking model"
```

---

## Task 2: Completion Popup Component

**Files:**
- Create: `src/components/layout/CompletionPopup.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Add a failing popup UI test**

In `tests/frontend/app-shell.test.tsx`, replace the assertion in `auto-opens completion while typing without stealing editor focus`:

```ts
expect(await screen.findByLabelText("Completion Overlay")).toBeVisible();
expect(screen.getByRole("button", { name: /build\(\)/ })).toBeVisible();
await waitFor(() => expect(editor).toHaveFocus());
```

with:

```ts
const popup = await screen.findByRole("listbox", { name: "Code Completion" });
expect(popup).toBeVisible();
expect(screen.queryByLabelText("Completion Query")).not.toBeInTheDocument();
expect(within(popup).getByRole("option", { name: /Method build\(\).*Workspace/ })).toHaveAttribute("aria-selected", "true");
await waitFor(() => expect(editor).toHaveFocus());
```

- [ ] **Step 2: Run the UI test and verify failure**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "auto-opens completion while typing"
```

Expected: FAIL because `Code Completion` listbox is not rendered.

- [ ] **Step 3: Create popup component**

Create `src/components/layout/CompletionPopup.tsx`:

```tsx
import type { CompletionPresentation } from "@/components/layout/completion-model";

export type CompletionPopupPosition = {
  top: number;
  left: number;
};

type CompletionPopupProps = {
  items: CompletionPresentation[];
  selectedIndex: number;
  position: CompletionPopupPosition;
  status: "loading" | "ready" | "empty" | "error";
  message?: string;
  detailsVisible: boolean;
  onAccept: (item: CompletionPresentation) => void;
  onSelect: (index: number) => void;
};

export function CompletionPopup({
  items,
  selectedIndex,
  position,
  status,
  message,
  detailsVisible,
  onAccept,
  onSelect,
}: CompletionPopupProps) {
  const selectedItem = items[selectedIndex] ?? null;

  return (
    <div
      className="completion-popup"
      style={{ top: position.top, left: position.left }}
      aria-label="Code Completion"
      role="listbox"
    >
      {status === "loading" ? <div className="completion-popup__state">Loading suggestions...</div> : null}
      {status === "empty" ? <div className="completion-popup__state">No suggestions</div> : null}
      {status === "error" ? <div className="completion-popup__state">{message ?? "Completion unavailable"}</div> : null}
      {status === "ready" ? (
        <div className="completion-popup__items">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={`completion-popup__item${index === selectedIndex ? " completion-popup__item--selected" : ""}`}
              onMouseEnter={() => onSelect(index)}
              onClick={() => onAccept(item)}
            >
              <span className={`completion-popup__kind completion-popup__kind--${item.kind}`}>{item.kindLabel}</span>
              <span className="completion-popup__label">{item.label}</span>
              <span className="completion-popup__source">{item.sourceLabel}</span>
              {item.detail ? <span className="completion-popup__detail">{item.detail}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {detailsVisible && selectedItem ? (
        <aside className="completion-popup__details" aria-label="Completion Details">
          <strong>{selectedItem.label}</strong>
          <span>{selectedItem.detail || selectedItem.sourceLabel}</span>
        </aside>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Add popup CSS**

Append to `src/styles/app.css`:

```css
.completion-popup {
  position: absolute;
  width: min(460px, calc(100vw - 32px));
  max-height: 340px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: var(--shadow-overlay);
  overflow: hidden;
  z-index: 24;
}

.completion-popup__items {
  max-height: 320px;
  overflow: auto;
  padding: 4px;
}

.completion-popup__item {
  width: 100%;
  min-height: 30px;
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  padding: 4px 8px;
  text-align: left;
}

.completion-popup__item--selected {
  background: var(--accent-muted);
}

.completion-popup__kind {
  color: var(--text-muted);
  font-size: 11px;
}

.completion-popup__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}

.completion-popup__source,
.completion-popup__detail,
.completion-popup__state,
.completion-popup__details {
  color: var(--text-muted);
  font-size: 12px;
}

.completion-popup__detail {
  grid-column: 2 / 4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.completion-popup__state {
  padding: 10px 12px;
}

.completion-popup__details {
  border-top: 1px solid var(--border-subtle);
  padding: 8px 10px;
  display: grid;
  gap: 4px;
}
```

- [ ] **Step 5: Temporarily render popup from AppShell using existing completion data**

In `src/components/layout/AppShell.tsx`, import:

```ts
import { CompletionPopup } from "@/components/layout/CompletionPopup";
import { normalizeCompletionItems, rankCompletionItems } from "@/components/layout/completion-model";
```

Add before `return`:

```ts
  const normalizedCompletionItems = rankCompletionItems(
    normalizeCompletionItems(completionResults, {
      prefix: quickOpenQuery,
      lineTextBeforeCursor: "",
      trigger: completionAutoFocus ? "manual" : "typing",
      acceptedLabels: completionRecencyRef.current,
    }),
    {
      prefix: quickOpenQuery,
      lineTextBeforeCursor: "",
      trigger: completionAutoFocus ? "manual" : "typing",
      acceptedLabels: completionRecencyRef.current,
    },
  );
```

Render after `EditorSurface` and before `GitBlameCard`:

```tsx
      {activeOverlay === "completion" && normalizedCompletionItems.length > 0 ? (
        <CompletionPopup
          items={normalizedCompletionItems}
          selectedIndex={completionSelectedIndex}
          position={{ top: 96, left: 280 }}
          status="ready"
          message={undefined}
          detailsVisible={false}
          onSelect={setCompletionSelectedIndex}
          onAccept={(item) => insertCompletion(item.insertText)}
        />
      ) : null}
```

- [ ] **Step 6: Run the UI test and verify pass**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "auto-opens completion while typing"
```

Expected: PASS. This is an intermediate UI bridge; later tasks remove `activeOverlay === "completion"`.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/CompletionPopup.tsx src/components/layout/AppShell.tsx src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: render ide completion popup"
```

---

## Task 3: Caret Anchor From CodeMirror

**Files:**
- Modify: `src/editor/editor-events.ts`
- Modify: `src/editor/ArkTsEditor.tsx`
- Modify: `src/editor/LazyArkTsEditor.tsx`
- Modify: `src/components/layout/EditorSurface.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Add failing anchored-position test**

In `tests/frontend/app-shell.test.tsx`, add near completion tests:

```ts
it("positions code completion inside the active editor surface", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    completeSymbol: vi.fn(async () => [
      { label: "build()", detail: "Component lifecycle method", kind: "method" },
    ]),
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  const editor = await screen.findByLabelText("Editor Content");
  await user.click(editor);
  await user.keyboard("{Control>}{End}{/Control}b");

  const popup = await screen.findByRole("listbox", { name: "Code Completion" });
  expect(popup).toHaveAttribute("data-anchor", "editor-caret");
  expect(Number(popup.getAttribute("data-anchor-line"))).toBeGreaterThan(0);
  expect(Number(popup.getAttribute("data-anchor-column"))).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run anchored-position test and verify failure**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "positions code completion"
```

Expected: FAIL because popup has fixed fallback position and no anchor metadata.

- [ ] **Step 3: Export caret rectangle type/helper**

In `src/editor/editor-events.ts`, add:

```ts
export type EditorCaretRect = EditorLineColumn & {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export function readCaretRect(view: EditorView): EditorCaretRect {
  const head = view.state.selection.main.head;
  const rect = view.coordsAtPos(head);
  const selection = toLineColumn(view, head);
  if (!rect) {
    return {
      ...selection,
      top: 72,
      left: 240,
      bottom: 96,
      right: 241,
    };
  }

  return {
    ...selection,
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.right,
  };
}
```

- [ ] **Step 4: Pass caret rectangle from editor to AppShell**

In `src/editor/ArkTsEditor.tsx`, import `readCaretRect` and type:

```ts
import {
  readCaretRect,
  resolveDefinitionTokenRange,
  setJumpRevealEffect,
  type DefinitionHoverState,
  type EditorCaretRect,
  type EditorLineColumn,
} from "@/editor/editor-events";
```

Add prop:

```ts
  onCaretRectChange?: (rect: EditorCaretRect) => void;
```

Add ref:

```ts
  const onCaretRectChangeRef = useRef(onCaretRectChange);
  onCaretRectChangeRef.current = onCaretRectChange;
```

When creating extensions, wrap selection change:

```ts
        (selection) => {
          onSelectionChangeRef.current?.(selection);
          const view = viewRef.current;
          if (view) {
            onCaretRectChangeRef.current?.(readCaretRect(view));
          }
        },
```

After creating `new EditorView`, emit initial rect:

```ts
    onCaretRectChangeRef.current?.(readCaretRect(viewRef.current));
```

In `src/editor/LazyArkTsEditor.tsx`, add the same optional prop type and pass-through automatically through `<ArkTsEditor {...props} />`.

In `src/components/layout/EditorSurface.tsx`, import type and add prop:

```ts
import type { DefinitionHoverState, EditorCaretRect, EditorLineColumn } from "@/editor/editor-events";
```

```ts
  onCaretRectChange?: (rect: EditorCaretRect) => void;
```

Pass to `LazyArkTsEditor`:

```tsx
          onCaretRectChange={onCaretRectChange}
```

- [ ] **Step 5: Use caret rectangle in AppShell popup position**

In `src/components/layout/AppShell.tsx`, import type:

```ts
import type { EditorCaretRect } from "@/editor/editor-events";
```

Add state:

```ts
  const [completionAnchor, setCompletionAnchor] = useState<EditorCaretRect | null>(null);
```

Pass to `EditorSurface`:

```tsx
          onCaretRectChange={setCompletionAnchor}
```

Replace popup position:

```tsx
          position={{
            top: completionAnchor ? completionAnchor.bottom + 4 : 96,
            left: completionAnchor ? completionAnchor.left : 280,
          }}
```

Add metadata props to `CompletionPopup`:

```tsx
          anchor={completionAnchor}
```

Update `CompletionPopup.tsx` prop type:

```ts
import type { EditorCaretRect } from "@/editor/editor-events";
```

```ts
  anchor: EditorCaretRect | null;
```

Add attributes to root:

```tsx
      data-anchor={anchor ? "editor-caret" : "fallback"}
      data-anchor-line={anchor?.line ?? 0}
      data-anchor-column={anchor?.column ?? 0}
```

- [ ] **Step 6: Run anchored-position test and verify pass**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "positions code completion"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/editor/editor-events.ts src/editor/ArkTsEditor.tsx src/editor/LazyArkTsEditor.tsx src/components/layout/EditorSurface.tsx src/components/layout/AppShell.tsx src/components/layout/CompletionPopup.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: anchor completion popup to editor caret"
```

---

## Task 4: Completion Controller and Overlay Removal

**Files:**
- Create: `src/components/layout/use-completion-controller.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/SearchOverlayContent.tsx`
- Modify: `src/components/layout/search-overlay-model.ts`
- Modify: `src/components/layout/shell-state.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Update completion tests for non-overlay behavior**

In `tests/frontend/app-shell.test.tsx`, update all completion assertions:

```ts
screen.queryByLabelText("Completion Overlay")
```

to:

```ts
screen.queryByRole("listbox", { name: "Code Completion" })
```

Update manual completion test from:

```ts
const completionQuery = await screen.findByLabelText("Completion Query");
await user.click(completionQuery);
await waitFor(() => expect(completionQuery).toHaveFocus());
await user.type(completionQuery, "u");
```

to editor-driven filtering:

```ts
expect(screen.queryByLabelText("Completion Query")).not.toBeInTheDocument();
await waitFor(() => expect(editor).toHaveFocus());
await user.keyboard("u");
```

- [ ] **Step 2: Run completion tests and verify failures**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "completion"
```

Expected: FAIL because AppShell still uses overlay state and some tests still depend on `Completion Query`.

- [ ] **Step 3: Create completion controller**

Create `src/components/layout/use-completion-controller.ts`:

```ts
import { useMemo, useRef, useState } from "react";
import {
  normalizeCompletionItems,
  rankCompletionItems,
  type CompletionPresentation,
  type CompletionTrigger,
} from "@/components/layout/completion-model";
import { extractCompletionPrefix } from "@/components/layout/app-shell-helpers";
import type { LanguageCompletionItem, WorkspaceApi } from "@/features/workspace/workspace-api";

type Selection = { line: number; column: number };

type UseCompletionControllerArgs = {
  activePath: string | null;
  editorContent: string;
  getCurrentContent: () => string;
  workspaceApi: WorkspaceApi;
  settingsApplying: boolean;
  acceptedLabels: Map<string, number>;
  onStatusText: (text: string) => void;
};

export function useCompletionController({
  activePath,
  editorContent,
  getCurrentContent,
  workspaceApi,
  settingsApplying,
  acceptedLabels,
  onStatusText,
}: UseCompletionControllerArgs) {
  const [items, setItems] = useState<CompletionPresentation[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [replacementPrefix, setReplacementPrefix] = useState("");
  const [trigger, setTrigger] = useState<CompletionTrigger>("typing");
  const [detailsVisible, setDetailsVisible] = useState(false);
  const requestIdRef = useRef(0);
  const emptyCooldownRef = useRef<string | null>(null);

  const open = status === "loading" || status === "ready" || status === "empty" || status === "error";

  async function requestCompletion(selection: Selection, nextTrigger: CompletionTrigger) {
    if (settingsApplying) {
      close();
      onStatusText("SDK settings are still applying");
      return;
    }
    if (!activePath || !workspaceApi.completeSymbol) {
      close();
      onStatusText("Completion unavailable");
      return;
    }

    const currentContent = getCurrentContent() || editorContent;
    const prefix = extractCompletionPrefix(currentContent, selection.line, selection.column);
    const lineTextBeforeCursor = currentContent.split(/\r?\n/)[selection.line - 1]?.slice(0, Math.max(selection.column - 1, 0)) ?? "";
    const cooldownKey = `${activePath}:${selection.line}:${prefix}`;
    if (nextTrigger === "typing" && emptyCooldownRef.current === cooldownKey) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setTrigger(nextTrigger);
    setReplacementPrefix(prefix);
    if (nextTrigger === "manual") {
      setStatus("loading");
    }

    try {
      const rawItems: LanguageCompletionItem[] = await workspaceApi.completeSymbol({ path: activePath, line: selection.line, column: selection.column });
      if (requestIdRef.current !== requestId) return;

      const context = { prefix, lineTextBeforeCursor, trigger: nextTrigger, acceptedLabels };
      const rankedItems = rankCompletionItems(normalizeCompletionItems(rawItems, context), context);
      setItems(rankedItems);
      setSelectedIndex(0);
      if (rankedItems.length === 0) {
        emptyCooldownRef.current = cooldownKey;
        setStatus(nextTrigger === "manual" ? "empty" : "idle");
        onStatusText("No suggestions");
        return;
      }
      emptyCooldownRef.current = null;
      setStatus("ready");
      onStatusText(`Completion: ${rankedItems.length} items`);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setItems([]);
      setStatus(nextTrigger === "manual" ? "error" : "idle");
      onStatusText(error instanceof Error ? `Completion failed: ${error.message}` : "Completion unavailable");
    }
  }

  function close() {
    requestIdRef.current += 1;
    setStatus("idle");
    setItems([]);
    setSelectedIndex(0);
    setDetailsVisible(false);
  }

  function moveSelection(direction: 1 | -1) {
    setSelectedIndex((current) => {
      if (items.length === 0) return 0;
      return (current + direction + items.length) % items.length;
    });
  }

  function moveSelectionPage(direction: 1 | -1) {
    setSelectedIndex((current) => {
      if (items.length === 0) return 0;
      return Math.min(Math.max(current + direction * 8, 0), items.length - 1);
    });
  }

  function moveSelectionEdge(edge: "first" | "last") {
    setSelectedIndex(edge === "first" ? 0 : Math.max(items.length - 1, 0));
  }

  const selectedItem = useMemo(() => items[selectedIndex] ?? null, [items, selectedIndex]);

  return {
    open,
    status,
    items,
    selectedIndex,
    selectedItem,
    replacementPrefix,
    trigger,
    detailsVisible,
    requestCompletion,
    close,
    moveSelection,
    moveSelectionPage,
    moveSelectionEdge,
    setSelectedIndex,
    toggleDetails: () => setDetailsVisible((value) => !value),
  };
}
```

- [ ] **Step 4: Wire controller in AppShell**

In `src/components/layout/AppShell.tsx`:

- Remove `completionItems`, `completionReplacePrefix`, `completionSelectedIndex`, `completionAutoFocus`, and `typingCompletionTimerRef` state only after replacement compiles.
- Add:

```ts
  const typingCompletionTimerRef = useRef<number | null>(null);
  const completion = useCompletionController({
    activePath,
    editorContent,
    getCurrentContent: () => activePath ? documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent : editorContent,
    workspaceApi,
    settingsApplying,
    acceptedLabels: completionRecencyRef.current,
    onStatusText: setStatusText,
  });
```

Update request functions:

```ts
  async function openCompletionFromEditor() {
    await completion.requestCompletion(editorSelection, "manual");
    focusEditorSoon();
  }

  function triggerTypingCompletion(selection: { line: number; column: number }) {
    clearTypingCompletionTimer();
    if (settingsApplying) {
      setStatusText("SDK settings are still applying");
      return;
    }
    typingCompletionTimerRef.current = window.setTimeout(() => {
      void completion.requestCompletion(selection, "typing");
    }, 150);
  }

  function acceptCompletion(item = completion.selectedItem) {
    if (!item) return;
    completionRecencyCounterRef.current += 1;
    completionRecencyRef.current.set(item.label, completionRecencyCounterRef.current);
    setInsertTextTarget({ text: item.insertText, replaceBefore: completion.replacementPrefix.length, nonce: Date.now() });
    completion.close();
    setEditorFocusToken((token) => token + 1);
    setStatusText(`Inserted completion: ${item.label}`);
    focusEditorSoon();
  }
```

Render popup based on `completion.open`, not `activeOverlay`:

```tsx
      {completion.open ? (
        <CompletionPopup
          anchor={completionAnchor}
          items={completion.items}
          selectedIndex={completion.selectedIndex}
          position={{
            top: completionAnchor ? completionAnchor.bottom + 4 : 96,
            left: completionAnchor ? completionAnchor.left : 280,
          }}
          status={completion.status === "idle" ? "empty" : completion.status}
          message={undefined}
          detailsVisible={completion.detailsVisible}
          onSelect={completion.setSelectedIndex}
          onAccept={acceptCompletion}
        />
      ) : null}
```

Update `closeTransientUi()` before overlays:

```ts
    if (completion.open) {
      completion.close();
      focusEditor();
      return true;
    }
```

Update `setOverlay()` to close completion:

```ts
    completion.close();
```

- [ ] **Step 5: Remove completion from search overlay files**

In `src/components/layout/shell-state.ts`, remove `"completion"` from `OverlayKey`.

In `src/components/layout/search-overlay-model.ts`, remove completion from accepted overlay types and `getOverlayLabel`.

In `src/components/layout/SearchOverlayContent.tsx`, remove:

```tsx
  if (activeOverlay === "completion") {
    return (...);
  }
```

Remove completion-specific props from `SearchOverlayContentProps` and from the `SearchOverlayContent` call in `AppShell`.

- [ ] **Step 6: Run completion tests and verify pass**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "completion"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/use-completion-controller.ts src/components/layout/AppShell.tsx src/components/layout/SearchOverlayContent.tsx src/components/layout/search-overlay-model.ts src/components/layout/shell-state.ts tests/frontend/app-shell.test.tsx
git commit -m "feat: move completion out of search overlays"
```

---

## Task 5: Completion Keyboard Model

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/CompletionPopup.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Add keyboard behavior tests**

Add near completion tests:

```ts
it("closes only code completion with Escape", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    completeSymbol: vi.fn(async () => [
      { label: "build()", detail: "Component lifecycle method", kind: "method" },
    ]),
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  const editor = await screen.findByLabelText("Editor Content");
  await user.click(editor);
  await user.keyboard("{Control>}{End}{/Control}b");

  expect(await screen.findByRole("listbox", { name: "Code Completion" })).toBeVisible();
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
  expect(editor).toHaveFocus();
});

it("uses page and edge keys inside code completion", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    completeSymbol: vi.fn(async () => Array.from({ length: 12 }, (_, index) => ({
      label: `item${index}`,
      detail: "Workspace symbol",
      kind: "function",
    }))),
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  const editor = await screen.findByLabelText("Editor Content");
  await user.click(editor);
  await user.keyboard("{Control>} {/Control}");

  const popup = await screen.findByRole("listbox", { name: "Code Completion" });
  await user.keyboard("{PageDown}");
  expect(within(popup).getByRole("option", { name: /item8/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{End}");
  expect(within(popup).getByRole("option", { name: /item11/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Home}");
  expect(within(popup).getByRole("option", { name: /item0/ })).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 2: Run keyboard tests and verify failure**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "code completion"
```

Expected: FAIL for unimplemented page/edge keys or Escape ordering.

- [ ] **Step 3: Add AppShell key capture for completion**

In `src/components/layout/AppShell.tsx`, add an effect after completion is created:

```ts
  useEffect(() => {
    function handleCompletionKeys(event: KeyboardEvent) {
      if (!completion.open || !isEditorFocused()) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        completion.close();
        focusEditorSoon();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        completion.moveSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        completion.moveSelectionPage(event.key === "PageDown" ? 1 : -1);
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        completion.moveSelectionEdge(event.key === "Home" ? "first" : "last");
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        acceptCompletion();
        return;
      }
      if (event.key === "Enter" && completion.selectedItem) {
        event.preventDefault();
        acceptCompletion();
      }
    }

    window.addEventListener("keydown", handleCompletionKeys, true);
    return () => window.removeEventListener("keydown", handleCompletionKeys, true);
  }, [completion.open, completion.selectedItem, completion.items, completion.selectedIndex]);
```

Keep `closeTransientUi()` completion branch so shell `Esc` also closes completion when the global hotkey sees it.

- [ ] **Step 4: Run keyboard tests and verify pass**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "code completion"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add ide completion keyboard handling"
```

---

## Task 6: Trigger Rules, Empty States, and Stale Requests

**Files:**
- Modify: `src/editor/editor-events.ts`
- Modify: `src/components/layout/use-completion-controller.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Add trigger and stale-request tests**

Add near completion tests:

```ts
it("does not render automatic completion for empty results", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    completeSymbol: vi.fn(async () => []),
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(await screen.findByLabelText("Editor Content"));
  await user.keyboard("{Control>}{End}{/Control}z");

  await waitFor(() => expect(workspaceApi.completeSymbol).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
  expect(await screen.findByText("No suggestions")).toBeVisible();
});

it("ignores stale completion responses after continued typing", async () => {
  const user = userEvent.setup();
  let resolveFirst: (items: { label: string; detail: string; kind: string }[]) => void = () => undefined;
  const first = new Promise<{ label: string; detail: string; kind: string }[]>((resolve) => {
    resolveFirst = resolve;
  });
  const completeSymbol = vi.fn()
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce([{ label: "button()", detail: "Workspace symbol", kind: "function" }]);
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    completeSymbol,
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  const editor = await screen.findByLabelText("Editor Content");
  await user.click(editor);
  await user.keyboard("{Control>}{End}{/Control}b");
  await waitFor(() => expect(completeSymbol).toHaveBeenCalledTimes(1));
  await user.keyboard("u");
  await waitFor(() => expect(completeSymbol).toHaveBeenCalledTimes(2));
  resolveFirst([{ label: "build()", detail: "Stale item", kind: "method" }]);

  const popup = await screen.findByRole("listbox", { name: "Code Completion" });
  expect(within(popup).queryByRole("option", { name: /build\(\)/ })).not.toBeInTheDocument();
  expect(within(popup).getByRole("option", { name: /button\(\)/ })).toBeVisible();
});
```

- [ ] **Step 2: Run tests and verify failures**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "automatic completion|stale completion"
```

Expected: FAIL if stale request handling or empty automatic state is incomplete.

- [ ] **Step 3: Refine typing trigger listener**

In `src/editor/editor-events.ts`, locate `createTypingCompletionTriggerListener` and update it:

```ts
function shouldTriggerCompletion(update: ViewUpdate) {
  if (!update.docChanged) {
    return false;
  }

  let inserted = "";
  update.changes.iterChanges((_fromA, _toA, _fromB, _toB, text) => {
    inserted += text.toString();
  });

  if (!inserted || inserted.includes("\n")) {
    return false;
  }

  const last = inserted.at(-1) ?? "";
  return /^[A-Za-z0-9_$@]$/.test(last) || [".", "(", "<", "\"", "'"].includes(last);
}

export function createTypingCompletionTriggerListener(
  onTypingCompletionTrigger: (selection: EditorLineColumn) => void,
) {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!shouldTriggerCompletion(update)) {
      return;
    }

    onTypingCompletionTrigger(toLineColumn(update.view, update.state.selection.main.head));
  });
}
```

- [ ] **Step 4: Ensure controller ignores stale responses**

In `src/components/layout/use-completion-controller.ts`, verify `requestIdRef.current !== requestId` guards both success and error paths. Add this check before setting state:

```ts
if (requestIdRef.current !== requestId) {
  return;
}
```

Also ensure automatic empty results call:

```ts
setStatus(nextTrigger === "manual" ? "empty" : "idle");
```

- [ ] **Step 5: Run tests and verify pass**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "automatic completion|stale completion|auto-opens completion"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/editor/editor-events.ts src/components/layout/use-completion-controller.ts tests/frontend/app-shell.test.tsx
git commit -m "feat: stabilize completion triggers"
```

---

## Task 7: Final Migration Cleanup and Verification

**Files:**
- Modify: `tests/frontend/app-shell.test.tsx`
- Modify: `tests/frontend/editor.test.tsx` if editor prop types require test updates
- Modify: any TypeScript files required by compiler after previous tasks

- [ ] **Step 1: Search for removed overlay labels**

Run:

```bash
rg -n "Completion Overlay|Completion Query|activeOverlay === \"completion\"" src tests/frontend
```

Expected: no `Completion Overlay`, `Completion Query`, or `activeOverlay === "completion"` references remain.

- [ ] **Step 2: Fix any stale references**

If `rg` finds stale references, replace them:

```ts
screen.queryByLabelText("Completion Overlay")
```

becomes:

```ts
screen.queryByRole("listbox", { name: "Code Completion" })
```

and any `Completion Query` expectations become:

```ts
expect(screen.queryByLabelText("Completion Query")).not.toBeInTheDocument();
```

- [ ] **Step 3: Run focused frontend verification**

Run:

```bash
pnpm exec vitest run tests/frontend/completion-model.test.ts tests/frontend/app-shell.test.tsx tests/frontend/editor.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full frontend test suite**

Run:

```bash
pnpm test
```

Expected: PASS with all Vitest files passing.

- [ ] **Step 5: Run build**

Run:

```bash
pnpm build
```

Expected: PASS, TypeScript and Vite build complete.

- [ ] **Step 6: Run Tauri tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Commit cleanup**

```bash
git add src tests
git commit -m "test: verify ide completion foundation"
```

If Step 1 finds no stale references and Steps 3-6 pass without additional edits, skip this commit.

---

## Self-Review Notes

- Spec coverage:
  - Editor-anchored popup: Tasks 2 and 3.
  - No completion query input / no generic overlay: Task 4.
  - Keyboard model: Task 5.
  - Quiet automatic empty/error behavior: Task 6.
  - Stale request handling: Task 6.
  - Deterministic ranking and ArkUI source priority: Task 1.
  - Ghost text extension point: Task 1 type model; no UI implementation, matching non-goal.
  - Existing overlay surfaces preserved: Task 4 and Task 7 verification.
- Scope check:
  - This plan does not implement AI, ghost text UI, commit-character acceptance, or semantic-worker rewrites.
- Type consistency:
  - `CompletionPresentation`, `CompletionContext`, `CompletionPopup`, and `useCompletionController` names are consistent across tasks.
