# ArkLine Completion Quality Gap Report

Date: 2026-06-24

## Purpose

This report reviews ArkLine's current code-completion content quality after the IDE-style completion UI migration. It focuses on the gap between ArkLine, local DevEco Studio behavior, mainstream IDE expectations, and near-future completion trends.

The main user-facing symptom is still valid: system ArkUI APIs such as `width` can be inconsistent across completion and jump-to-definition contexts. The recent UI work made completion feel like an IDE popup, but the content engine is still much thinner than DevEco Studio, IntelliJ IDEA, VS Code language extensions, or AI-assisted IDEs.

## Research Rounds

### Round 1: ArkLine Current Boundary

Current ArkLine completion is split across:

- UI/controller: `src/components/layout/AppShell.tsx`, `src/components/layout/CompletionPopup.tsx`, `src/components/layout/completion-model.ts`.
- Frontend protocol type: `src/features/workspace/workspace-api.ts`.
- Rust bridge/session parsing: `src-tauri/src/services/semantic_host/session.rs`.
- Semantic worker protocol: `semantic-worker/src/protocol.ts`.
- Semantic worker completion: `semantic-worker/src/features/completion.ts`.
- ArkUI SDK metadata index: `semantic-worker/src/sdk/arkui-api-index.ts`.

The UI now has a respectable IDE-style interaction model:

- editor-anchored popup
- keyboard navigation
- stale request guards
- manual empty state
- automatic empty suppression
- source-aware ranking

But the completion item contract is still only:

```ts
type LanguageCompletionItem = {
  label: string
  detail: string
  kind: string
}
```

This is the core content-quality bottleneck. It cannot express:

- `insertText`
- `filterText`
- `sortText`
- replacement range
- overloads
- commit characters
- deprecated tags
- source/module identity
- documentation markdown
- parameter snippets
- additional text edits/import insertion
- item data for lazy resolve
- confidence / provider identity
- whether an item came from SDK, workspace, fallback, or AI

ArkLine currently has to infer too much from `label` and `detail`, which makes ranking, insertion, and documentation fragile.

### Round 2: ArkUI System API Evidence

Local DevEco Studio exists at:

```text
/Applications/DevEco-Studio.app
```

The bundled default OpenHarmony SDK contains the ArkUI data that ArkLine needs:

```text
/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/component/common.d.ts
/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/components/common_attrs.json
/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/components/*.json
```

Observed local evidence:

- `common_attrs.json` includes `width`.
- `common.d.ts` contains:
  - `width(value: Length): T;`
  - `width(widthValue: Length | LayoutPolicy): T;`
- `units.d.ts` defines `Length`.
- Component declaration files such as `text.d.ts`, `button.d.ts`, `column.d.ts`, and others extend `CommonMethod<T>` or component-specific attribute classes.

ArkLine already has a first-pass ArkUI index:

- `completeArkuiApis(sdkRoot, component)` returns universal and component-specific attributes.
- `findArkuiApiDefinition(sdkRoot, name, component)` can resolve SDK declaration locations.
- completion context detection is heuristic and line-oriented.
- definition receiver detection is heuristic and line-oriented.

This means `width` is no longer completely absent from the data model. The remaining gap is mostly in precision:

- receiver/component inference is too shallow
- declaration parsing is regex-only
- overloads are collapsed into one visible item
- no parameter-aware insertion
- no signature help after accepting `width(`
- no documentation resolve path
- no typed range replacement
- no robust ArkTS/ArkUI AST model
- no provider confidence or fallback explanation

### Round 3: DevEco Studio Local Architecture Signals

The local DevEco Studio installation shows two relevant families of capability:

```text
/Applications/DevEco-Studio.app/Contents/plugins/openharmony/lib/ace-lsp-6.1.1.280.jar
/Applications/DevEco-Studio.app/Contents/plugins/openharmony/lib/ohos-ark-ui-client-6.1.1.280.jar
/Applications/DevEco-Studio.app/Contents/plugins/openharmony/lib/sdk-idea-6.1.1.280.jar
/Applications/DevEco-Studio.app/Contents/plugins/codegenie-plugin/lib/instrumented-codegenie-completion.jar
/Applications/DevEco-Studio.app/Contents/plugins/codegenie-plugin/lib/rag-core-6.1.1.280.jar
/Applications/DevEco-Studio.app/Contents/plugins/codegenie-plugin/lib/langchain4j-*.jar
/Applications/DevEco-Studio.app/Contents/lib/modules/intellij.platform.inline.completion.jar
```

Inference from local structure:

- DevEco is not just scanning `.d.ts` files with regexes.
- It appears to combine IntelliJ platform completion infrastructure, OpenHarmony/ArkUI-specific plugins, LSP-like language services, SDK models, and CodeGenie AI/RAG features.
- It likely has separate providers for basic symbol completion, ArkUI DSL completion, SDK declarations, inspections, inline completion, and AI suggestions.

ArkLine currently has one semantic-worker completion function and one small SDK index. That is enough for an MVP, but not enough to feel DevEco-grade.

### Round 4: Mainstream IDE Baseline

Mainstream completion engines converge around a few layers:

- typed syntax/semantic model
- multiple completion providers
- ranking and relevance scoring
- item resolve/lazy documentation
- insertion edits/snippets
- signature help
- inline/ghost completion
- AI suggestions as a separate lane
- telemetry or local feedback for ranking

Useful reference points:

- Language Server Protocol 3.17 completion model: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
- VS Code programmatic language features: https://code.visualstudio.com/api/language-extensions/programmatic-language-features
- VS Code API completion and inline completion providers: https://code.visualstudio.com/api/references/vscode-api
- IntelliJ Platform completion contributors: https://plugins.jetbrains.com/docs/intellij/code-completion.html
- IntelliJ Platform inline completion: https://plugins.jetbrains.com/docs/intellij/inline-completion.html
- JetBrains AI code completion help: https://www.jetbrains.com/help/idea/ai-assistant-code-completion.html

The important lesson is architectural: high-quality completion is a composition pipeline, not one list function.

## Gap Matrix

| Area | ArkLine Today | DevEco / IDE Baseline | Gap |
| --- | --- | --- | --- |
| UI popup | Good after recent work | IDE-like | Small |
| Keyboard model | Good | IDE-like | Small |
| SDK attribute indexing | Partial ArkUI metadata index | Deep SDK/plugin model | Medium |
| `width` jump | Possible in recognized ArkUI chain contexts | Broadly reliable | Medium |
| `width` completion | Possible in recognized component-chain contexts | Broadly reliable, typed | Medium |
| Completion item data | `label/detail/kind` only | rich item protocol | Large |
| Replacement range | prefix-length heuristic | exact text edit range | Large |
| Overloads | collapsed/first match | overload-aware | Large |
| Documentation | short detail only | markdown docs, signatures, links | Large |
| Signature help | absent | available after `(` and during args | Large |
| Import/additional edits | absent | common | Large |
| Type inference | heuristics | parser/type/service-backed | Large |
| Provider architecture | one worker function | multiple provider lanes | Large |
| Inline/AI completion | absent | growing mainstream | Large |
| Ranking feedback | local recency only | usage/context/ML/AI aware | Medium-Large |

## Why `width` Still Fails In Some Cases

`width` is a universal ArkUI attribute in SDK metadata, so data availability is not the main problem. The common failure modes are:

1. The editor position is not recognized as an ArkUI receiver context.
2. The receiver component cannot be inferred from surrounding DSL syntax.
3. Multi-line chains and nested builder syntax exceed the regex heuristic.
4. The worker returns `label/detail/kind`, losing the declaration identity needed by the UI.
5. Completion insertion and jump rely on the cursor symbol/prefix rather than an exact semantic range.
6. Overloaded declarations collapse into one entry, which weakens both detail display and target choice.

Example risky shapes:

```ets
Column() {
  Text("Hi")
}
.wi
```

```ets
Text("Hi")
  .fontSize(16)
  .wi
```

```ets
if (ready) {
  Column()
    .wi
}
```

```ets
builder() {
  Row() {
    Text("Hi")
  }
  .wi
}
```

The current regex approach can cover some of these, but not reliably.

## Future Trend Gap

The industry direction is moving beyond classic popup completion:

1. **Structured LSP-quality items**
   Completion results carry edit ranges, insert text format, tags, commit characters, documentation, and lazy resolve data.

2. **Inline completion lane**
   Ghost text / inline completion is now a separate first-class experience. It should not compete visually with symbol completion.

3. **Provider arbitration**
   IDEs combine syntax, semantic, SDK, snippets, path/module, recent usage, and AI providers. The UI shows one ranked list, but the engine keeps provider identity.

4. **Context-aware documentation**
   The selected item shows signature, overloads, docs, API level, deprecation, and source module. For ArkUI, API availability/version matters.

5. **AI/RAG as an assistive layer**
   DevEco's local CodeGenie plugin evidence suggests RAG/LLM assistance is part of the target landscape. ArkLine does not need this first, but the data model should not block it.

6. **Local-first semantic cache**
   Good IDEs build durable indices. ArkLine currently reloads/scans too much through narrow request paths.

## Recommended Direction

### Recommendation: Build A Completion Quality Pipeline Before Adding AI

The next phase should not start with AI. ArkLine needs a richer deterministic completion protocol first. Without that, AI suggestions would sit on top of weak insertion, weak docs, and weak context.

Recommended phases:

1. **Completion Protocol V2**
   Extend `LanguageCompletionItem` / semantic protocol to include:
   - `id`
   - `label`
   - `kind`
   - `source`
   - `detail`
   - `documentation`
   - `insertText`
   - `filterText`
   - `sortText`
   - `replacementRange`
   - `commitCharacters`
   - `definitionTarget`
   - `data` for lazy resolve

2. **ArkUI Context Engine**
   Replace line regexes with a small ArkTS UI DSL scanner:
   - track component call blocks
   - track chained attributes
   - identify current receiver component
   - compute exact replacement range
   - return confidence and reason

3. **SDK Declaration Index V2**
   Improve `arkui-api-index.ts`:
   - preserve overloads
   - index `CommonMethod<T>` inheritance and component-specific attributes
   - include `Length`, enum, and parameter type targets
   - cache by SDK root and file mtimes

4. **Completion Details Panel**
   Use the richer item data to show:
   - signature
   - overload count
   - documentation summary
   - source path/module
   - API version/deprecation when available

5. **Signature Help**
   After accepting or typing `width(`, show parameter help:
   - active parameter
   - overload selection
   - type hints such as `Length | LayoutPolicy`

6. **Inline Completion Lane**
   Add a separate ghost-text provider later:
   - deterministic first: complete likely chain continuations
   - AI later: local/offline or optional remote provider

## Design Options For Next Implementation

### Option A: ArkUI System API Precision Sprint

Scope:

- enrich SDK index
- improve ArkUI receiver scanner
- add exact replacement range
- fix `width` completion/jump cases
- keep protocol changes minimal but add `insertText`, `source`, `definitionTarget`

Pros:

- fastest path to fixing the user's concrete `width` complaint
- low UI churn
- builds directly on current semantic-worker files

Cons:

- still not a full IDE completion architecture
- may need another protocol migration soon

### Option B: Completion Protocol V2 First

Scope:

- define rich completion protocol end-to-end
- update Rust bridge and frontend model
- migrate existing providers to V2
- then improve ArkUI system API quality

Pros:

- correct foundation
- avoids repeatedly changing item shape
- aligns with LSP/IDE future

Cons:

- more plumbing before visible `width` improvements
- higher risk and broader test updates

### Option C: Provider Pipeline Architecture

Scope:

- introduce providers:
  - workspace provider
  - ArkTS decorator/lifecycle provider
  - ArkUI SDK provider
  - snippets provider
  - future AI/inline provider
- merge/rank results through a central arbiter

Pros:

- closest to mainstream IDE architecture
- easiest to extend later

Cons:

- larger design and implementation effort
- may be overkill before item protocol is richer

## Recommendation

Use a hybrid of A and B:

1. Start with **Completion Protocol V2 Minimal**:
   - `insertText`
   - `filterText`
   - `source`
   - `replacementRange`
   - `definitionTarget`
   - `documentation`

2. Immediately apply it to **ArkUI System API Precision**:
   - fix `width`
   - fix component-chain completion
   - preserve overload signatures
   - expose SDK declaration targets

3. Defer provider pipeline and AI until the deterministic path is solid.

This gives visible quality improvement without painting ArkLine into a corner.

## Proposed Acceptance Criteria For The Next Phase

Minimum:

- completion after `.wi` in ArkUI component chains suggests `width`.
- accepting `width` inserts only the missing suffix or full method consistently.
- Ctrl/Cmd-click on `width` opens SDK `common.d.ts`.
- completion detail shows `width(value: Length): T` and source `ArkUI universal attribute`.
- stale responses and current keyboard behavior remain intact.

Strong:

- multi-line chains resolve receiver component.
- `Text().fontSize().width` style chains work.
- component-specific attributes rank above generic fallback when component is known.
- overloads are visible or at least preserved in detail.
- missing SDK degrades to fallback without broken UI.

Future-facing:

- item protocol can support signature help, commit characters, and inline completion without another full rewrite.

## Open Technical Questions

1. Should ArkLine treat DevEco's bundled SDK as an auto-detect candidate when user SDK path is empty?
2. Should `definitionTarget` be embedded in each completion item, or resolved lazily via item `data`?
3. Should ArkUI metadata indexing happen in semantic-worker only, or be warmed by Rust semantic host after SDK apply?
4. Should replacement ranges be UTF-16/LSP-style or current 1-based line/column style?
5. Should completion docs include raw JSDoc markdown now, or only summary text until the details panel is built?

## Bottom Line

ArkLine's completion UI is now ahead of its content engine. The next meaningful quality jump is not visual polish; it is a richer completion protocol plus a stronger ArkUI SDK semantic layer.

For `width`, the missing ingredient is no longer data availability. The data exists locally. The gap is robust context recognition, exact edit ranges, richer item payloads, and SDK-aware detail/definition identity.
