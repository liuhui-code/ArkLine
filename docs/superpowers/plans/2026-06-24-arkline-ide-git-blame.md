# ArkLine IDE Git Blame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an IDE-style Git Blame experience with toggleable file annotations, current-line blame, dirty-buffer attribution, and non-disruptive commit inspection.

**Architecture:** Keep Git command execution in the existing Tauri Git trace service. Add a frontend attribution mapping layer that projects saved-file blame onto the current editor buffer, then render that mapped attribution through CodeMirror gutters, current-line status text, and a focused commit card. The bottom Git Trace panel remains the deeper investigation surface, but no longer owns the first-click blame experience.

**Tech Stack:** React, TypeScript, CodeMirror, Tauri Rust commands, Vitest, Testing Library, Cargo tests.

---

## File Structure

- Create `src/features/git/blame-buffer-mapper.ts`
  - Maps committed blame lines plus base/current text into current-buffer attribution rows.
- Modify `src/features/git/git-trace-model.ts`
  - Adds attribution statuses and extended state fields while keeping compatibility with existing commit trace data.
- Modify `src/components/layout/use-git-trace.ts`
  - Stops disabling blame for dirty files. Loads saved blame, applies buffer mapping, and tracks current-line attribution.
- Modify `src/components/layout/AppShell.tsx`
  - Owns the full-file blame toggle, status text, and explicit Git Trace opening from blame actions.
- Modify `src/components/layout/EditorSurface.tsx`, `src/editor/ArkTsEditor.tsx`, `src/editor/LazyArkTsEditor.tsx`, `src/editor/editor-extensions.ts`
  - Passes mapped attributions, visibility, hover/click actions, and selected commit range into the editor.
- Modify `src/editor/git-trace-decorations.ts`
  - Renders fixed-width blame gutter markers from mapped attribution instead of raw saved-line entries.
- Create `src/components/layout/GitBlameCard.tsx`
  - Compact commit/local-change card for hover or focused selection actions.
- Modify `src/components/layout/GitTracePanel.tsx`
  - Improves summary/actions/diff structure while preserving existing behavior.
- Modify `src/styles/app.css`
  - Adds stable gutter, current-line blame, card, and panel styles.
- Test `tests/frontend/git-blame-buffer-mapper.test.ts`
  - Covers dirty mapping.
- Test `tests/frontend/app-shell.test.tsx`
  - Covers toggle and dirty retention at shell level.
- Test `tests/frontend/editor.test.tsx`
  - Covers gutter rendering and click/close behavior.

---

### Task 1: Add Current-Buffer Blame Attribution Model

**Files:**
- Modify: `src/features/git/git-trace-model.ts`
- Create: `src/features/git/blame-buffer-mapper.ts`
- Test: `tests/frontend/git-blame-buffer-mapper.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `tests/frontend/git-blame-buffer-mapper.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapBlameToBuffer } from "@/features/git/blame-buffer-mapper";
import type { GitBlameLine } from "@/features/git/git-trace-model";

const blame: GitBlameLine[] = [
  {
    line: 1,
    commit: "aaa1111",
    sourceLine: 1,
    author: "Jane Doe",
    authoredAt: "2026-06-20T10:00:00Z",
    relativeTime: "4d ago",
    summary: "Add entry component",
  },
  {
    line: 2,
    commit: "bbb2222",
    sourceLine: 2,
    author: "Alex Chen",
    authoredAt: "2026-06-21T10:00:00Z",
    relativeTime: "3d ago",
    summary: "Add build method",
  },
  {
    line: 3,
    commit: "ccc3333",
    sourceLine: 3,
    author: "Mina Park",
    authoredAt: "2026-06-22T10:00:00Z",
    relativeTime: "2d ago",
    summary: "Add text widget",
  },
];

describe("mapBlameToBuffer", () => {
  it("keeps committed attribution around an inserted line", () => {
    const result = mapBlameToBuffer({
      baseText: "@Entry\nbuild() {}\nText('Hi')",
      currentText: "@Entry\n@Component\nbuild() {}\nText('Hi')",
      blameLines: blame,
    });

    expect(result.map((line) => ({
      bufferLine: line.bufferLine,
      status: line.status,
      author: line.author,
      sourceLine: line.sourceLine,
    }))).toEqual([
      { bufferLine: 1, status: "committed", author: "Jane Doe", sourceLine: 1 },
      { bufferLine: 2, status: "added", author: undefined, sourceLine: undefined },
      { bufferLine: 3, status: "committed", author: "Alex Chen", sourceLine: 2 },
      { bufferLine: 4, status: "committed", author: "Mina Park", sourceLine: 3 },
    ]);
  });

  it("marks changed lines as modified while preserving original attribution", () => {
    const result = mapBlameToBuffer({
      baseText: "@Entry\nbuild() {}\nText('Hi')",
      currentText: "@Entry\nbuild() { return }\nText('Hi')",
      blameLines: blame,
    });

    expect(result[1]).toMatchObject({
      bufferLine: 2,
      status: "modified",
      originalCommit: "bbb2222",
      originalAuthor: "Alex Chen",
    });
  });

  it("returns committed rows unchanged when text matches the base", () => {
    const result = mapBlameToBuffer({
      baseText: "@Entry\nbuild() {}\nText('Hi')",
      currentText: "@Entry\nbuild() {}\nText('Hi')",
      blameLines: blame,
    });

    expect(result.every((line) => line.status === "committed")).toBe(true);
    expect(result.map((line) => line.bufferLine)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/frontend/git-blame-buffer-mapper.test.ts
```

Expected: FAIL because `blame-buffer-mapper.ts` does not exist.

- [ ] **Step 3: Extend model and implement mapper**

Add to `src/features/git/git-trace-model.ts`:

```ts
export type GitBlameAttributionStatus = "committed" | "added" | "modified" | "unavailable";

export type GitBlameAttribution = {
  bufferLine: number;
  sourceLine?: number;
  status: GitBlameAttributionStatus;
  commit?: string;
  shortCommit?: string;
  author?: string;
  authoredAt?: string;
  relativeTime?: string;
  summary?: string;
  originalCommit?: string;
  originalAuthor?: string;
};
```

Create `src/features/git/blame-buffer-mapper.ts`:

```ts
import type { GitBlameAttribution, GitBlameLine } from "@/features/git/git-trace-model";

type MapBlameToBufferArgs = {
  baseText: string;
  currentText: string;
  blameLines: GitBlameLine[];
};

export function mapBlameToBuffer({ baseText, currentText, blameLines }: MapBlameToBufferArgs): GitBlameAttribution[] {
  const baseLines = splitLines(baseText);
  const currentLines = splitLines(currentText);
  const blameBySourceLine = new Map(blameLines.map((line) => [line.line, line]));
  const rows: GitBlameAttribution[] = [];
  let baseIndex = 0;
  let currentIndex = 0;

  while (currentIndex < currentLines.length) {
    const currentLine = currentLines[currentIndex] ?? "";
    const baseLine = baseLines[baseIndex];

    if (baseLine === currentLine) {
      rows.push(committedAttribution(currentIndex + 1, blameBySourceLine.get(baseIndex + 1)));
      baseIndex += 1;
      currentIndex += 1;
      continue;
    }

    const laterBaseIndex = findNextMatchingLine(baseLines, baseIndex + 1, currentLine);
    if (laterBaseIndex >= 0) {
      while (baseIndex < laterBaseIndex) {
        baseIndex += 1;
      }
      rows.push(committedAttribution(currentIndex + 1, blameBySourceLine.get(baseIndex + 1)));
      baseIndex += 1;
      currentIndex += 1;
      continue;
    }

    const nextCurrentLine = currentLines[currentIndex + 1];
    if (nextCurrentLine !== undefined && baseLine !== undefined && nextCurrentLine === baseLine) {
      rows.push({ bufferLine: currentIndex + 1, status: "added" });
      currentIndex += 1;
      continue;
    }

    rows.push(modifiedAttribution(currentIndex + 1, blameBySourceLine.get(baseIndex + 1)));
    baseIndex += baseLine === undefined ? 0 : 1;
    currentIndex += 1;
  }

  return rows;
}

function splitLines(text: string) {
  return text.length === 0 ? [""] : text.split(/\r?\n/);
}

function findNextMatchingLine(lines: string[], startIndex: number, target: string) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index] === target) {
      return index;
    }
  }
  return -1;
}

function committedAttribution(bufferLine: number, blame?: GitBlameLine): GitBlameAttribution {
  if (!blame) {
    return { bufferLine, status: "unavailable" };
  }

  return {
    bufferLine,
    sourceLine: blame.sourceLine,
    status: "committed",
    commit: blame.commit,
    shortCommit: blame.commit.slice(0, 7),
    author: blame.author,
    authoredAt: blame.authoredAt,
    relativeTime: blame.relativeTime,
    summary: blame.summary,
  };
}

function modifiedAttribution(bufferLine: number, blame?: GitBlameLine): GitBlameAttribution {
  return {
    ...committedAttribution(bufferLine, blame),
    status: "modified",
    originalCommit: blame?.commit,
    originalAuthor: blame?.author,
  };
}
```

- [ ] **Step 4: Run mapper test**

Run:

```bash
pnpm exec vitest run tests/frontend/git-blame-buffer-mapper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/git/git-trace-model.ts src/features/git/blame-buffer-mapper.ts tests/frontend/git-blame-buffer-mapper.test.ts
git commit -m "feat: map git blame onto dirty buffers"
```

---

### Task 2: Keep Blame Available While Editing

**Files:**
- Modify: `src/components/layout/use-git-trace.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing dirty-retention test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("keeps committed blame visible around an unsaved inserted line", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openDemoWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}\nText('Hi')",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
      {
        line: 2,
        commit: "bbb2222",
        sourceLine: 2,
        author: "Alex Chen",
        authoredAt: "2026-06-21T10:00:00Z",
        relativeTime: "3d ago",
        summary: "Add build method",
      },
      {
        line: 3,
        commit: "ccc3333",
        sourceLine: 3,
        author: "Mina Park",
        authoredAt: "2026-06-22T10:00:00Z",
        relativeTime: "2d ago",
        summary: "Add text widget",
      },
    ],
  });

  const { container } = render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByLabelText("Editor Content"));
  await user.keyboard("{Home}{ArrowDown}{Enter}@Component");

  await waitFor(() => {
    expect(container.querySelector(".cm-git-trace-marker")).toBeTruthy();
  });

  expect(container).toHaveTextContent("Uncommitted");
  expect(container).toHaveTextContent("Jane Doe");
  expect(container).toHaveTextContent("Alex Chen");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "keeps committed blame visible"
```

Expected: FAIL because dirty files currently make blame unavailable.

- [ ] **Step 3: Thread base/current text into blame state**

Update `UseGitTraceArgs` in `src/components/layout/use-git-trace.ts`:

```ts
type UseGitTraceArgs = {
  activeLine: number;
  activePath: string | null;
  activeText: string;
  baseText: string;
  activeTool: "problems" | "terminal" | "git" | "gitTrace" | "usages";
  workspaceApi: WorkspaceApi;
};
```

Import and apply the mapper:

```ts
import { mapBlameToBuffer } from "@/features/git/blame-buffer-mapper";
```

Replace the dirty-file early return with mapped attribution after successful blame load:

```ts
const attributions = mapBlameToBuffer({
  baseText,
  currentText: activeText,
  blameLines: result,
});
```

Store both raw blame and attributions in `GitTraceState`.

- [ ] **Step 4: Pass active/base text from AppShell**

In `src/components/layout/AppShell.tsx`, pass active editor content and the saved/base document content into `useGitTrace`. Use the existing open tab/document state as the base source that represents the loaded saved file.

- [ ] **Step 5: Run dirty-retention test**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "keeps committed blame visible"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/use-git-trace.ts src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "fix: keep git blame visible while editing"
```

---

### Task 3: Add Toggleable Full-File Blame and Current-Line Blame

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/ShellStatusBar.tsx`
- Modify: `src/components/layout/EditorSurface.tsx`
- Modify: `src/editor/ArkTsEditor.tsx`
- Modify: `src/editor/LazyArkTsEditor.tsx`
- Modify: `src/editor/editor-extensions.ts`
- Modify: `src/editor/git-trace-decorations.ts`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`
- Test: `tests/frontend/editor.test.tsx`

- [ ] **Step 1: Write failing toggle test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("toggles full-file Git Blame without closing the bottom tool window", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
  });

  const { container } = render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByRole("tab", { name: "Terminal" }));
  await user.click(screen.getByRole("button", { name: /Toggle Git Blame/i }));

  expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  expect(container.querySelector(".cm-git-trace-marker")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /Toggle Git Blame/i }));

  expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  expect(container.querySelector(".cm-git-trace-marker")).toBeNull();
});
```

- [ ] **Step 2: Write failing current-line blame test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("shows lightweight current-line blame while full-file blame is closed", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));

  expect(await screen.findByText(/Jane Doe.*4d ago/)).toBeVisible();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Git Blame|current-line blame"
```

Expected: FAIL because there is no toggle button/current-line blame surface.

- [ ] **Step 4: Implement visibility state and status action**

In `AppShell`, add:

```ts
const [isGitBlameVisible, setIsGitBlameVisible] = useState(false);
const toggleGitBlame = useCallback(() => {
  setIsGitBlameVisible((visible) => !visible);
}, []);
```

Render a compact status/action button:

```tsx
<button
  type="button"
  className="status-bar__action"
  aria-label="Toggle Git Blame"
  onClick={toggleGitBlame}
>
  {isGitBlameVisible ? "Blame On" : "Blame Off"}
</button>
```

Add a current-line blame string near the existing status bar content.

- [ ] **Step 5: Gate gutter rendering by visibility**

Pass `isGitBlameVisible` into `EditorSurface` and editor components. Only include `createGitTraceGutter` when the flag is true. Keep current-line blame independent from full-file gutter visibility.

- [ ] **Step 6: Render attribution labels**

Update `git-trace-decorations.ts` to accept `GitBlameAttribution[]` and render:

```ts
function buildBlameLabel(blame: GitBlameAttribution) {
  if (blame.status === "added") {
    return "Uncommitted";
  }
  if (blame.status === "modified") {
    return `Modified · ${blame.originalAuthor ?? blame.author ?? "Unknown"}`;
  }
  return `${blame.author ?? "Unknown"} · ${blame.relativeTime ?? ""}`.trim();
}
```

- [ ] **Step 7: Run toggle/current-line tests**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Git Blame|current-line blame"
pnpm exec vitest run tests/frontend/editor.test.tsx --testNamePattern "blame"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/layout/ShellStatusBar.tsx src/components/layout/EditorSurface.tsx src/editor/ArkTsEditor.tsx src/editor/LazyArkTsEditor.tsx src/editor/editor-extensions.ts src/editor/git-trace-decorations.ts src/styles/app.css tests/frontend/app-shell.test.tsx tests/frontend/editor.test.tsx
git commit -m "feat: toggle ide-style git blame annotations"
```

---

### Task 4: Add Non-Disruptive Blame Card and Explicit Git Trace Opening

**Files:**
- Create: `src/components/layout/GitBlameCard.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/editor/git-trace-decorations.ts`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing card test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("opens a compact blame card without switching bottom tools", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
  });

  const { container } = render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByRole("tab", { name: "Terminal" }));
  await user.click(screen.getByRole("button", { name: /Toggle Git Blame/i }));
  await user.click(container.querySelector<HTMLButtonElement>(".cm-git-trace-marker")!);

  expect(screen.getByRole("dialog", { name: "Git Blame Details" })).toHaveTextContent("Add entry component");
  expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");

  await user.click(screen.getByRole("button", { name: "Show Diff" }));

  expect(screen.getByRole("tab", { name: "Git Trace" })).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "compact blame card"
```

Expected: FAIL because no card exists.

- [ ] **Step 3: Implement `GitBlameCard`**

Create `src/components/layout/GitBlameCard.tsx`:

```tsx
import type { GitBlameAttribution } from "@/features/git/git-trace-model";

type GitBlameCardProps = {
  attribution: GitBlameAttribution;
  onClose: () => void;
  onShowDiff: () => void;
  onCopyHash: () => void;
};

export function GitBlameCard({ attribution, onClose, onShowDiff, onCopyHash }: GitBlameCardProps) {
  const isLocal = attribution.status === "added" || attribution.status === "modified";

  return (
    <aside role="dialog" aria-label="Git Blame Details" className="git-blame-card">
      <div className="git-blame-card__header">
        <strong>{isLocal ? "Local uncommitted change" : attribution.summary}</strong>
        <button type="button" aria-label="Close Git Blame Details" onClick={onClose}>x</button>
      </div>
      <div className="git-blame-card__meta">
        <span>{attribution.author ?? attribution.originalAuthor ?? "Uncommitted"}</span>
        <span>{attribution.relativeTime ?? "Working tree"}</span>
        {attribution.shortCommit ? <code>{attribution.shortCommit}</code> : null}
      </div>
      <div className="git-blame-card__actions">
        <button type="button" onClick={onShowDiff}>Show Diff</button>
        <button type="button" onClick={onCopyHash} disabled={!attribution.commit}>Copy Hash</button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Wire card selection**

In `AppShell`, store selected attribution. On gutter click, set selected attribution and selected line, but do not switch tools. `Show Diff` calls the existing `showBottomTool("gitTrace")` path.

- [ ] **Step 5: Add styles**

Add stable, IDE-like styles in `src/styles/app.css`:

```css
.git-blame-card {
  position: absolute;
  right: 24px;
  top: 88px;
  z-index: 20;
  width: min(420px, calc(100vw - 48px));
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}
```

- [ ] **Step 6: Run card test**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "compact blame card"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/GitBlameCard.tsx src/components/layout/AppShell.tsx src/editor/git-trace-decorations.ts src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: inspect git blame without switching tools"
```

---

### Task 5: Improve Git Trace Panel Structure

**Files:**
- Modify: `src/components/layout/GitTracePanel.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing panel structure test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("shows structured Git Trace sections for a selected commit", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
    getCommitTrace: async () => ({
      commit: "aaa1111",
      shortCommit: "aaa1111",
      author: "Jane Doe",
      email: "jane@example.com",
      authoredAt: "2026-06-20T10:00:00Z",
      subject: "Add entry component",
      relativePath: "src/main.ets",
      selectedLine: 1,
      sourceLine: 1,
      patch: "diff --git a/src/main.ets b/src/main.ets\n+@Entry",
    }),
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByRole("tab", { name: "Git Trace" }));

  const panel = await screen.findByLabelText("Git Trace Panel");
  expect(within(panel).getByRole("heading", { name: "Commit" })).toBeVisible();
  expect(within(panel).getByRole("heading", { name: "Actions" })).toBeVisible();
  expect(within(panel).getByRole("heading", { name: "Diff Preview" })).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "structured Git Trace"
```

Expected: FAIL because panel lacks semantic sections.

- [ ] **Step 3: Refactor panel markup**

Update `GitTracePanel.tsx` to render sections with headings:

```tsx
<section className="git-trace-panel__section">
  <h3>Commit</h3>
  ...
</section>
<section className="git-trace-panel__section">
  <h3>Actions</h3>
  ...
</section>
<section className="git-trace-panel__section git-trace-panel__section--diff">
  <h3>Diff Preview</h3>
  <pre className="git-trace-panel__patch">{state.detail.patch}</pre>
</section>
```

- [ ] **Step 4: Run panel test**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "structured Git Trace"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/GitTracePanel.tsx src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: structure git trace commit details"
```

---

### Task 6: Verification and Cleanup

**Files:**
- Modify only files from earlier tasks if verification exposes issues.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
pnpm exec vitest run tests/frontend/git-blame-buffer-mapper.test.ts tests/frontend/editor.test.tsx tests/frontend/app-shell.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full frontend test suite**

Run:

```bash
pnpm test
```

Expected: PASS. Existing non-fatal React `act(...)` warnings may appear, but the command must exit 0.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run Tauri tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes:

```bash
git add <changed-plan-owned-files>
git commit -m "fix: stabilize ide git blame workflow"
```

If no fixes were needed, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage: The plan covers toggleable blame, current-line blame, dirty-buffer retention, commit inspection, explicit Git Trace opening, and panel cleanup. Deferred industry features are intentionally excluded from MVP.
- Placeholder scan: No task uses placeholder-only instructions; each task includes concrete files, tests, commands, and expected results.
- Type consistency: The plan consistently uses `GitBlameAttribution`, `bufferLine`, `sourceLine`, and status values `committed | added | modified | unavailable`.
