# ArkLine IDE Completion Foundation Design

Date: 2026-06-24
Status: Draft for review

## Goal

ArkLine should make code completion feel like a mainstream IDE rather than a command palette. The next completion phase should replace the current generic completion overlay with an editor-anchored completion popup that keeps typing in the editor, supports predictable keyboard acceptance, and presents ArkTS / ArkUI / SDK suggestions clearly.

The design also reserves a future lane for inline ghost text and AI-style completion, but the first implementation phase remains deterministic: language-service items, SDK items, workspace symbols, snippets, and fallback symbols.

## Market Calibration

Current mainstream editors have converged on a two-lane model:

- Deterministic suggestion lists for symbols, methods, properties, snippets, keywords, and SDK APIs.
- Inline prediction or ghost text for full-line, multi-token, or AI-assisted suggestions.

VS Code IntelliSense keeps code completion tied to language-service results and exposes typed item categories such as methods, properties, snippets, and text. JetBrains IDEs keep smart completion, basic completion, and newer inline completion as related but distinct surfaces. Cursor emphasizes fast Tab-based prediction for next edits, but that experience works best when it does not fight a traditional popup.

ArkLine should follow the same split:

- `suggestionList`: implemented in this phase as an IDE-style popup.
- `inlineGhostText`: reserved for a later phase.

References:

- VS Code IntelliSense: https://code.visualstudio.com/docs/editing/intellisense
- JetBrains code completion: https://www.jetbrains.com/help/idea/auto-completing-code.html
- Cursor product positioning for Tab autocomplete: https://cursor.com/
- JetBrains full-line completion paper: https://arxiv.org/abs/2405.08704
- JetBrains control-model completion paper: https://arxiv.org/abs/2601.20223

## Current ArkLine State

ArkLine already has useful completion plumbing:

- `AppShell` calls `workspaceApi.completeSymbol`.
- Manual completion is exposed through `Ctrl/Cmd+Space`.
- Typing-triggered completion is debounced and uses the current editor selection.
- Accepted items are remembered for recency-aware ranking.
- Settings apply blocks definition and completion while SDK / semantic settings are in transition.
- `SearchOverlayContent` renders completion through a generic overlay with a `Completion Query` input.

The main product gap is the presentation layer. The current completion overlay behaves like a small command palette:

- it is not anchored to the caret;
- it has its own filter input;
- it can make automatic completion feel like a modal interaction;
- it shares too much UI structure with quick open, command palette, and Search Everywhere.

The next phase should keep the existing request pipeline where possible, but move completion out of the general search overlay path.

## Product Principles

1. Editor remains the active typing surface.

Completion must not steal focus during automatic completion. The user should keep typing in CodeMirror while the popup filters and repositions.

2. Keyboard behavior must be boring and predictable.

`Tab`, `Enter`, arrow keys, and `Esc` should match user expectations from VS Code, JetBrains IDEs, and Cursor-like editors.

3. Suggestions must explain where they came from.

ArkTS / ArkUI users need to distinguish SDK component attributes, workspace symbols, snippets, keywords, and fallback results.

4. Low confidence states should stay quiet.

Empty results, stale requests, SDK applying, and semantic errors should not produce noisy modal UI.

5. AI completion must not overload the first phase.

Ghost text needs a clean extension point, but deterministic completion should be stable first.

## Interaction Model

### Triggering

Manual completion:

- `Ctrl/Cmd+Space` opens the popup even if there is no prefix.
- Manual completion may show all relevant suggestions for the current context.
- Manual completion should not move focus to a query input because no query input exists.

Automatic completion:

- Identifier typing triggers completion after a debounce of 150 ms.
- Context characters trigger immediately:
  - `.`
  - `(`
  - `<`
  - `"`
  - `'`
- The popup should not auto-open while settings are applying.
- The popup should not auto-open when the language service returns no items.
- Repeated empty results for the same prefix should apply a short cooldown to avoid request loops.

Dismissal and cancellation:

- `Esc` closes the popup first.
- Moving the caret outside the trigger range closes the popup.
- Switching files closes the popup.
- Opening Search Everywhere, Quick Open, Command Palette, Settings, or project dialogs closes the popup.
- Saving should not implicitly accept or dismiss an item unless the editor already does so for unrelated reasons.

### Keyboard

- `ArrowDown` / `ArrowUp`: move selection.
- `PageDown` / `PageUp`: move by viewport-sized chunks.
- `Home` / `End`: move to first / last item when popup is open.
- `Tab`: accept selected suggestion.
- `Enter`: smart accept. It accepts when the popup has an active selected item and the selection would replace text. If the popup is empty or no item is active, it behaves as normal editor Enter.
- `Esc`: close popup only.
- `Ctrl/Cmd+Space` while popup is open: toggle details pane visibility.

Commit characters such as `.`, `(`, `,`, and `;` should not accept suggestions in the first phase. They can be added later once ranking and context are stronger.

### Mouse

- Clicking an item accepts it.
- Hovering an item selects it after a short delay or immediately if pointer movement is intentional.
- Clicking outside the popup closes it without changing editor content.
- The popup should never trap pointer interaction with the editor.

## UI Design

### Placement

The completion popup is anchored to the caret. CodeMirror should provide the caret rectangle or editor coordinates. If there is not enough space below the caret, the popup opens above it.

Sizing:

- width: 360-460 px;
- max visible rows: 8-10;
- row height: stable, around 28-32 px;
- border radius: 6-8 px;
- no nested cards;
- visual tone: restrained IDE panel with light border and subtle shadow.

The popup must remain inside the viewport and should avoid covering the current line when possible.

### Item Layout

Each suggestion row contains:

- kind icon or compact kind chip;
- label;
- optional signature or insert text hint;
- source label;
- detail summary when space allows.

Recommended kind mapping:

- `method`: method icon, e.g. `build()`;
- `property`: property icon, e.g. `width`;
- `class` / `struct`: type icon;
- `snippet`: snippet icon;
- `keyword`: keyword icon;
- `arkui`: ArkUI component or modifier marker;
- `fallback`: muted fallback marker.

Source labels:

- `ArkUI SDK`
- `Workspace`
- `Current file`
- `Snippet`
- `Fallback`

### Details Pane

The details pane is optional and should not appear instantly for every item. It should open when:

- the user toggles details with `Ctrl/Cmd+Space`;
- the selected item is stable for a short delay;
- the item has useful docs, signature, or source path.

Details pane content:

- signature;
- short documentation;
- source path or SDK declaration path when available;
- deprecated / experimental tags if the backend supplies them.

The first phase can include the details-pane shell with minimal content from `detail`; richer docs can follow once SDK metadata improves.

### Loading, Empty, Error

Loading:

- Automatic completion should show no popup until results arrive unless the previous popup is still valid.
- Manual completion may show a compact loading row if the request takes longer than 120 ms.

Empty:

- Automatic empty result: no popup; status text `No suggestions`.
- Manual empty result: compact popup row `No suggestions`.

Error:

- Automatic error: no popup; status text `Completion unavailable`.
- Manual error: compact row with failure message and status text.

Stale request:

- Ignore results when the file, selection, prefix, or request id no longer matches.

## Data Model

Extend the frontend model without requiring a backend protocol break on day one.

```ts
type CompletionSurface = "suggestionList" | "inlineGhostText";

type CompletionSource =
  | "arkuiSdk"
  | "workspace"
  | "currentFile"
  | "snippet"
  | "fallback"
  | "unknown";

type CompletionItemKind =
  | "method"
  | "property"
  | "class"
  | "struct"
  | "component"
  | "snippet"
  | "keyword"
  | "text"
  | "unknown";

type CompletionPresentation = {
  label: string;
  insertText?: string;
  detail?: string;
  documentation?: string;
  kind: CompletionItemKind;
  source: CompletionSource;
  sortText?: string;
  replacementPrefix: string;
};
```

Existing `LanguageCompletionItem` can be adapted into this shape at the AppShell boundary:

- `label` maps to `label`;
- `detail` maps to `detail`;
- `kind` maps into `CompletionItemKind`;
- missing `source` defaults to `unknown` or `fallback` depending on provider path.

Backend enrichment can come later without blocking the UI split.

## Ranking

Ranking should be deterministic and explainable.

Priority order:

1. Context-valid items.
2. Exact prefix match.
3. Case-insensitive prefix match.
4. Camel-case / word-boundary match.
5. Contains match.
6. Recently accepted item boost.
7. Stable fallback by kind and label.

Context priority:

- Current file and current lexical scope outrank workspace globals.
- ArkUI chain context outranks broad SDK globals.
- After `Column().`, ArkUI modifier candidates such as `width`, `height`, and `justifyContent` outrank unrelated workspace symbols.
- After `Text().`, text modifiers such as `fontSize`, `fontColor`, and `maxLines` outrank layout-only suggestions.

Recency must never override a more precise prefix match. It only breaks ties among plausible matches.

## Architecture

### New Components

`CompletionPopup`

- Pure presentation component.
- Receives positioned popup state, items, selected index, loading / empty / error state, details visibility.
- Emits accept, select, hover, and details toggle actions.

`useCompletionController`

- Owns request lifecycle, request ids, debounce, stale-response filtering, cooldown, ranking, selected index, and open / close state.
- Exposes actions used by AppShell and editor hotkeys.

`completion-model.ts`

- Defines normalized presentation item types, ranking helpers, source mapping, and helper functions.

### AppShell Changes

`AppShell` should stop representing completion as `activeOverlay === "completion"`.

Instead:

- Quick Open, Command Palette, Recent Files, Search Everywhere, and Go To Line remain overlay-based.
- Completion becomes an editor-adjacent surface with its own state.
- `requestCompletion`, `triggerTypingCompletion`, `insertCompletion`, and selection movement move into a controller or smaller hook.
- Settings applying continues to gate completion before any request is issued.

### Editor Integration

`EditorSurface` should receive:

- completion popup open state;
- selected line / column anchor;
- insertion target;
- key handlers or action callbacks.

The popup can render near the editor container, but its coordinates should be derived from CodeMirror. If exact caret coordinates are not available in the first implementation pass, use a small adapter that exposes the current caret rectangle from the editor view.

## Ghost Text Extension Point

Do not implement ghost text in this phase, but reserve these rules:

- `Tab` priority:
  1. open suggestion popup accepts selected popup item;
  2. otherwise visible ghost text accepts inline suggestion;
  3. otherwise normal editor Tab behavior.
- Ghost text does not appear while suggestion popup is open unless explicitly allowed in a later design.
- Ghost text uses a separate request source and separate cancellation token.
- Ghost text never writes text until accepted.

The future type can be:

```ts
type InlineGhostTextState = {
  status: "idle" | "loading" | "ready" | "error";
  text: string;
  range: { line: number; column: number };
  source: "localModel" | "remoteModel" | "heuristic";
};
```

## Accessibility

The popup should use combobox/listbox semantics without moving focus away from the editor:

- editor keeps focus;
- popup container has an accessible label such as `Code Completion`;
- selected item exposes `aria-selected`;
- item kind and source are present in accessible text;
- `Esc` close behavior is predictable.

Because focus remains in CodeMirror, keyboard handling must be explicit and tested.

## Testing

Frontend tests:

- typing opens an editor-anchored completion popup without focusing an input;
- manual completion opens the popup and keeps editor as active surface;
- `Tab` accepts selected item;
- `Enter` smart-accept behavior works;
- `Esc` closes only completion popup;
- arrows move selected item;
- continued typing filters and preserves popup state;
- empty automatic completion does not render popup;
- manual empty completion shows `No suggestions`;
- stale completion request is ignored;
- settings applying blocks manual and automatic completion;
- ArkUI component-chain suggestions rank above unrelated items;
- Search Everywhere / Command Palette behavior remains unchanged.

Model tests:

- prefix ranking;
- camel-case ranking;
- recency tie-break;
- source priority;
- ArkUI context priority;
- stable ordering.

Backend / semantic worker tests:

- existing completion tests continue passing;
- ArkUI SDK completion enrichment tests can be added in the separate ArkUI semantic implementation plan.

## Non-Goals

- No AI provider integration in this phase.
- No full-line ghost text UI in this phase.
- No commit-character acceptance in this phase.
- No large semantic-worker rewrite in this phase.
- No visual redesign of Search Everywhere, Quick Open, or Command Palette.

## Acceptance Criteria

- Completion no longer renders through `SearchOverlayContent`.
- Automatic completion never focuses a completion query input.
- Popup is visually anchored to the editor caret or a stable caret-adjacent fallback.
- `Tab`, `Enter`, `Esc`, and arrow keys behave predictably.
- Empty and error states are quiet for automatic completion.
- Settings applying still blocks completion.
- Existing completion tests are updated and remain passing.
- Existing Search Everywhere, Command Palette, Quick Open, and Go To Line tests remain passing.
- Data model leaves a clear future slot for `inlineGhostText`.
