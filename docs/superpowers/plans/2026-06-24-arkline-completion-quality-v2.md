# ArkLine Completion Quality V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade ArkLine completion content quality so ArkUI system APIs such as `width` complete and jump reliably with richer item metadata, exact replacement ranges, SDK definition targets, and documentation-ready payloads.

**Architecture:** Introduce a minimal Completion Protocol V2 across semantic-worker, Rust bridge, and frontend while preserving backward compatibility with existing `label/detail/kind` items. Then use the richer protocol to improve ArkUI SDK completions and definitions around component chains. Keep AI/inline completion out of this phase, but choose data shapes that can support those later.

**Tech Stack:** TypeScript semantic-worker, Rust/Tauri semantic host, React/Vitest frontend tests, CodeMirror editor events.

---

## File Structure

- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/protocol.ts`
  - Adds optional Completion V2 fields to `SemanticCompletionItem`.
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
  - Mirrors the richer completion item type for frontend consumers.
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/language.rs`
  - Adds optional fields to Rust `CompletionItem`.
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic_host/session.rs`
  - Parses optional completion V2 fields from semantic-worker JSON.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/sdk/arkui-api-index.ts`
  - Preserves overloads and exposes SDK targets/documentation on completion entries.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/completion.ts`
  - Emits V2 item fields for ArkUI SDK and workspace completions.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/definition.ts`
  - Reuses improved ArkUI receiver context for `width` definitions.
- Create: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/arkui-context.ts`
  - Holds focused ArkUI receiver and replacement-range heuristics.
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/completion-model.ts`
  - Normalizes V2 item fields without losing old item support.
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
  - Uses replacement ranges and `insertText` when accepting completion.
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/CompletionPopup.tsx`
  - Displays richer signature/source/doc fields when available.
- Tests:
  - `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`
  - `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/definition.test.ts`
  - `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic_host/session.rs`
  - `/Users/liuhui/Documents/code/ArkLine/tests/frontend/completion-model.test.ts`
  - `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

## Task 1: Define Completion Protocol V2 Types

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/protocol.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/completion-model.test.ts`

- [x] **Step 1: Add failing frontend model test for richer item fields**

Add this test to `/Users/liuhui/Documents/code/ArkLine/tests/frontend/completion-model.test.ts`:

```ts
it("preserves completion protocol v2 metadata for SDK items", () => {
  const items = normalizeCompletionItems([
    {
      label: "width",
      detail: "width(value: Length): T",
      kind: "method",
      insertText: "width(${1:value})",
      filterText: "width",
      sortText: "0100-width",
      source: "arkui",
      documentation: "Sets the width of the component.",
      replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
      definitionTarget: { path: "/sdk/ets/component/common.d.ts", line: 20927, column: 5 },
    },
  ], {
    prefix: "wi",
    lineTextBeforeCursor: "    .wi",
    trigger: "typing",
    acceptedLabels: [],
  })

  expect(items[0]).toMatchObject({
    label: "width",
    insertText: "width(${1:value})",
    filterText: "width",
    sortText: "0100-width",
    source: "arkui",
    documentation: "Sets the width of the component.",
    replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
    definitionTarget: { path: "/sdk/ets/component/common.d.ts", line: 20927, column: 5 },
  })
})
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm exec vitest run tests/frontend/completion-model.test.ts --testNamePattern "protocol v2"
```

Expected: FAIL because `LanguageCompletionItem` and `CompletionPresentation` do not expose the new optional fields.

- [x] **Step 3: Extend semantic-worker protocol type**

In `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/protocol.ts`, replace `SemanticCompletionItem` with:

```ts
export interface SemanticTextRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface SemanticDefinitionTarget {
  path: string
  line: number
  column: number
}

export interface SemanticCompletionItem {
  label: string
  detail: string
  kind: string
  insertText?: string
  filterText?: string
  sortText?: string
  source?: "workspace" | "arkts" | "arkui" | "sdk" | "fallback"
  documentation?: string
  replacementRange?: SemanticTextRange
  commitCharacters?: string[]
  definitionTarget?: SemanticDefinitionTarget
  data?: Record<string, unknown>
}
```

Keep the existing `SemanticDefinitionTarget` export as this single definition; do not duplicate it later in the file.

- [x] **Step 4: Extend frontend completion item type**

In `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`, add:

```ts
export type TextRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};
```

Replace `LanguageCompletionItem` with:

```ts
export type LanguageCompletionItem = {
  label: string;
  detail: string;
  kind: string;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  source?: "workspace" | "arkts" | "arkui" | "sdk" | "fallback";
  documentation?: string;
  replacementRange?: TextRange;
  commitCharacters?: string[];
  definitionTarget?: DefinitionTarget;
  data?: Record<string, unknown>;
};
```

- [x] **Step 5: Extend completion presentation model**

In `/Users/liuhui/Documents/code/ArkLine/src/components/layout/completion-model.ts`, extend `CompletionPresentation` with:

```ts
  insertText: string;
  filterText: string;
  sortText?: string;
  documentation?: string;
  replacementRange?: LanguageCompletionItem["replacementRange"];
  definitionTarget?: LanguageCompletionItem["definitionTarget"];
  commitCharacters: string[];
```

In `normalizeCompletionItems`, derive:

```ts
const filterText = item.filterText ?? item.label;
const insertText = item.insertText ?? item.label;
```

and include:

```ts
insertText,
filterText,
sortText: item.sortText,
documentation: item.documentation,
replacementRange: item.replacementRange,
definitionTarget: item.definitionTarget,
commitCharacters: item.commitCharacters ?? [],
```

Update filtering/ranking helpers to compare against `filterText` as well as `label`.

- [x] **Step 6: Run tests**

Run:

```bash
pnpm exec vitest run tests/frontend/completion-model.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add semantic-worker/src/protocol.ts src/features/workspace/workspace-api.ts src/components/layout/completion-model.ts tests/frontend/completion-model.test.ts
git commit -m "feat: define completion protocol v2 fields"
```

## Task 2: Parse Completion V2 Through Rust Semantic Host

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/language.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic_host/session.rs`

- [x] **Step 1: Add failing Rust parser test**

Add this test inside the `tests` module in `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic_host/session.rs`:

```rust
#[test]
fn parses_completion_v2_fields() {
    let item = serde_json::json!({
        "label": "width",
        "detail": "width(value: Length): T",
        "kind": "method",
        "insertText": "width(${1:value})",
        "filterText": "width",
        "sortText": "0100-width",
        "source": "arkui",
        "documentation": "Sets the width of the component.",
        "replacementRange": {
            "startLine": 8,
            "startColumn": 6,
            "endLine": 8,
            "endColumn": 8
        },
        "commitCharacters": ["(", "."],
        "definitionTarget": {
            "path": "/sdk/ets/component/common.d.ts",
            "line": 20927,
            "column": 5
        },
        "data": { "provider": "arkui-sdk" }
    });

    let parsed = parse_completion_item(&item).expect("completion item should parse");

    assert_eq!(parsed.label, "width");
    assert_eq!(parsed.insert_text.as_deref(), Some("width(${1:value})"));
    assert_eq!(parsed.filter_text.as_deref(), Some("width"));
    assert_eq!(parsed.sort_text.as_deref(), Some("0100-width"));
    assert_eq!(parsed.source.as_deref(), Some("arkui"));
    assert_eq!(parsed.documentation.as_deref(), Some("Sets the width of the component."));
    assert_eq!(parsed.commit_characters, vec!["(", "."]);
    assert_eq!(parsed.replacement_range.unwrap().start_column, 6);
    assert_eq!(parsed.definition_target.unwrap().line, 20927);
}
```

- [x] **Step 2: Run the failing Rust test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml parses_completion_v2_fields
```

Expected: FAIL because `parse_completion_item`, `TextRange`, and optional fields do not exist.

- [x] **Step 3: Extend Rust models**

In `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/language.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextRange {
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}
```

Update imports:

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;
```

Replace `CompletionItem` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    pub detail: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_range: Option<TextRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commit_characters: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_target: Option<DefinitionTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}
```

- [x] **Step 4: Add parser helper**

In `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic_host/session.rs`, add:

```rust
fn parse_completion_item(item: &Value) -> Option<CompletionItem> {
    Some(CompletionItem {
        label: item.get("label")?.as_str()?.to_string(),
        detail: item.get("detail")?.as_str()?.to_string(),
        kind: item.get("kind")?.as_str()?.to_string(),
        insert_text: item.get("insertText").and_then(Value::as_str).map(str::to_string),
        filter_text: item.get("filterText").and_then(Value::as_str).map(str::to_string),
        sort_text: item.get("sortText").and_then(Value::as_str).map(str::to_string),
        source: item.get("source").and_then(Value::as_str).map(str::to_string),
        documentation: item.get("documentation").and_then(Value::as_str).map(str::to_string),
        replacement_range: item.get("replacementRange").and_then(parse_text_range),
        commit_characters: item
            .get("commitCharacters")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        definition_target: item.get("definitionTarget").and_then(|value| parse_definition_target(value).ok()),
        data: item.get("data").cloned(),
    })
}

fn parse_text_range(payload: &Value) -> Option<crate::models::language::TextRange> {
    Some(crate::models::language::TextRange {
        start_line: payload.get("startLine")?.as_u64()? as u32,
        start_column: payload.get("startColumn")?.as_u64()? as u32,
        end_line: payload.get("endLine")?.as_u64()? as u32,
        end_column: payload.get("endColumn")?.as_u64()? as u32,
    })
}
```

Update `completion()` to use:

```rust
Ok(items.iter().filter_map(parse_completion_item).collect())
```

- [x] **Step 5: Run Rust semantic-host tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml semantic_host::session
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src-tauri/src/models/language.rs src-tauri/src/services/semantic_host/session.rs
git commit -m "feat: parse completion protocol v2"
```

## Task 3: Emit Rich ArkUI SDK Completion Items

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/sdk/arkui-api-index.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/completion.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`

- [x] **Step 1: Add failing semantic-worker test for `width` V2 item**

Add to `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`:

```ts
it("returns rich ArkUI width completion metadata", () => {
  const session = new SemanticWorkerSession()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-width-v2-"))
  tempRoots.push(root)
  const sdkRoot = createArkuiSdkFixture(root)
  process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  fs.mkdirSync(pagesDir, { recursive: true })
  const indexPath = path.join(pagesDir, "Index.ets")
  fs.writeFileSync(
    indexPath,
    [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Column() {",
      "      Text(\"Hi\")",
      "    }",
      "    .wi",
      "  }",
      "}",
      "",
    ].join("\n"),
  )

  const response = session.handle({
    id: "completion-arkui-width-v2",
    method: "completion",
    position: { path: indexPath, line: 8, column: 8 },
  })

  expect(response.ok).toBe(true)
  const items = response.payload as Array<Record<string, unknown>>
  expect(items).toContainEqual(expect.objectContaining({
    label: "width",
    detail: "width(value: Length): T",
    kind: "method",
    insertText: "width(${1:value})",
    filterText: "width",
    source: "arkui",
    documentation: "Sets the width of the component.",
    replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
    definitionTarget: expect.objectContaining({ path: expect.stringContaining("common.d.ts"), line: 3, column: 5 }),
  }))
})
```

- [x] **Step 2: Run the failing test**

Run:

```bash
pnpm --dir semantic-worker test -- completion --testNamePattern "width completion metadata"
```

Expected: FAIL because ArkUI completions do not emit V2 fields.

- [x] **Step 3: Preserve overload data in ArkUI entries**

In `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/sdk/arkui-api-index.ts`, extend `ArkuiApiEntry`:

```ts
  documentation?: string
  overloads?: Array<{
    signature: string
    line: number
    column: number
    detail: string
  }>
```

When collecting methods, use all matching methods:

```ts
const methods = commonMethods.filter((item) => item.name === name)
const primary = methods[0]
return primary
  ? [{
    name,
    kind: "universalAttribute" as const,
    path: primary.path ?? commonDeclarationPath,
    line: primary.line,
    column: primary.column,
    signature: primary.signature,
    detail: primary.signature,
    documentation: primary.detail || "ArkUI universal attribute",
    overloads: methods.map((method) => ({
      signature: method.signature,
      line: method.line,
      column: method.column,
      detail: method.detail,
    })),
  }]
  : []
```

Use the same pattern for component-specific entries.

- [x] **Step 4: Emit V2 item fields from completion**

In `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/completion.ts`, change `push` to accept optional item fields:

```ts
const push = (item: SemanticCompletionItem) => {
  if (!seen.has(item.label)) {
    seen.add(item.label)
    labels.push(item)
  }
}
```

Replace old calls with explicit objects:

```ts
push({ label: "@Entry", detail: "ArkTS decorator", kind: "keyword", source: "arkts" })
```

For ArkUI entries:

```ts
push({
  label: entry.name,
  detail: entry.signature || entry.detail,
  kind: "method",
  insertText: snippetForArkuiMethod(entry),
  filterText: entry.name,
  sortText: `0100-${entry.name}`,
  source: "arkui",
  documentation: entry.documentation ?? entry.detail,
  replacementRange: arkuiRange ?? undefined,
  commitCharacters: ["("],
  definitionTarget: { path: entry.path, line: entry.line, column: entry.column },
  data: { provider: "arkui-sdk", component: entry.component ?? null },
})
```

Add helper:

```ts
function snippetForArkuiMethod(entry: { name: string; signature: string }) {
  const firstParam = entry.signature.match(/\(([^):,\s]+)/)?.[1] ?? "value"
  return `${entry.name}(\${1:${firstParam}})`
}
```

- [x] **Step 5: Run semantic-worker completion tests**

Run:

```bash
pnpm --dir semantic-worker test -- completion
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add semantic-worker/src/sdk/arkui-api-index.ts semantic-worker/src/features/completion.ts semantic-worker/src/__tests__/completion.test.ts
git commit -m "feat: enrich arkui completion items"
```

## Task 4: Add ArkUI Context Scanner And Exact Replacement Ranges

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/arkui-context.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/completion.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/definition.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/definition.test.ts`

- [x] **Step 1: Add failing tests for multi-line chained `width` contexts**

Add to `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`:

```ts
it("completes width in a multi-line ArkUI chain", () => {
  const session = new SemanticWorkerSession()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-chain-completion-"))
  tempRoots.push(root)
  process.env.ARKLINE_HARMONY_SDK_PATH = createArkuiSdkFixture(root)

  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  fs.mkdirSync(pagesDir, { recursive: true })
  const indexPath = path.join(pagesDir, "Index.ets")
  fs.writeFileSync(
    indexPath,
    [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Text(\"Hi\")",
      "      .fontSize(16)",
      "      .wi",
      "  }",
      "}",
      "",
    ].join("\n"),
  )

  const response = session.handle({
    id: "completion-arkui-chain-width",
    method: "completion",
    position: { path: indexPath, line: 7, column: 10 },
  })

  expect(response.ok).toBe(true)
  const items = response.payload as Array<Record<string, unknown>>
  expect(items).toContainEqual(expect.objectContaining({
    label: "width",
    replacementRange: { startLine: 7, startColumn: 8, endLine: 7, endColumn: 10 },
  }))
})
```

Add to `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/definition.test.ts`:

```ts
it("resolves width in a multi-line ArkUI chain", () => {
  const session = new SemanticWorkerSession()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-chain-definition-"))
  tempRoots.push(root)
  const { sdkRoot, commonPath } = createArkuiSdkFixture(root)
  process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  fs.mkdirSync(pagesDir, { recursive: true })
  const indexPath = path.join(pagesDir, "Index.ets")
  fs.writeFileSync(
    indexPath,
    [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Text(\"Hi\")",
      "      .fontSize(16)",
      "      .width(100)",
      "  }",
      "}",
      "",
    ].join("\n"),
  )

  const response = session.handle({
    id: "definition-arkui-chain-width",
    method: "gotoDefinition",
    position: { path: indexPath, line: 7, column: 9 },
  })

  expect(response.ok).toBe(true)
  expect(response.payload).toEqual({ path: commonPath, line: 3, column: 5 })
})
```

- [x] **Step 2: Run failing tests**

Run:

```bash
pnpm --dir semantic-worker test -- --testNamePattern "multi-line ArkUI chain"
```

Expected: FAIL for at least one test because current receiver detection is line-oriented.

- [x] **Step 3: Create ArkUI context helper**

Create `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/arkui-context.ts`:

```ts
import type { SemanticDocumentPosition, SemanticTextRange } from "../protocol.js"

export type ArkuiContext = {
  component: string | null
  symbolPrefix: string
  replacementRange: SemanticTextRange
}

const COMPONENT_CALL = /\b([A-Z][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?:\{|$)/
const CHAIN_CALL = /^\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/

export function findArkuiContext(content: string, position: SemanticDocumentPosition): ArkuiContext | null {
  const lines = content.split(/\r?\n/)
  const lineText = lines[position.line - 1] ?? ""
  const cursorIndex = Math.max(position.column - 1, 0)
  const before = lineText.slice(0, cursorIndex)
  const access = before.match(/(^|\.)\s*([A-Za-z_$][A-Za-z0-9_$]*)?$/)
  if (!access) {
    return null
  }

  const symbolPrefix = access[2] ?? ""
  const prefixStart = cursorIndex - symbolPrefix.length + 1
  const replacementRange = {
    startLine: position.line,
    startColumn: Math.max(prefixStart, 1),
    endLine: position.line,
    endColumn: position.column,
  }

  const sameLineComponent = before.match(/([A-Z][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\.\s*[A-Za-z_$]*$/)
  if (sameLineComponent?.[1]) {
    return { component: sameLineComponent[1], symbolPrefix, replacementRange }
  }

  for (let index = position.line - 2; index >= 0; index -= 1) {
    const candidate = lines[index] ?? ""
    const chained = candidate.match(CHAIN_CALL)
    if (chained) {
      continue
    }
    const component = candidate.match(COMPONENT_CALL)
    if (component?.[1]) {
      return { component: component[1], symbolPrefix, replacementRange }
    }
    if (/^\s*(struct|class|function|if|for|while|switch)\b/.test(candidate)) {
      break
    }
  }

  return { component: null, symbolPrefix, replacementRange }
}
```

- [x] **Step 4: Use context helper in completion and definition**

In `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/completion.ts`, replace the `arkuiCompletionComponent` call site with:

```ts
const arkuiContext = findArkuiContext(content, position)
if (arkuiContext) {
  const sdkPath = discoverHarmonySdk().path ?? undefined
  for (const entry of completeArkuiApis(sdkPath, arkuiContext.component)) {
    if (arkuiContext.symbolPrefix && !entry.name.toLowerCase().startsWith(arkuiContext.symbolPrefix.toLowerCase())) {
      continue
    }
    push({
      label: entry.name,
      detail: entry.signature || entry.detail,
      kind: "method",
      insertText: snippetForArkuiMethod(entry),
      filterText: entry.name,
      sortText: `0100-${entry.name}`,
      source: "arkui",
      documentation: entry.documentation ?? entry.detail,
      replacementRange: arkuiContext.replacementRange,
      commitCharacters: ["("],
      definitionTarget: { path: entry.path, line: entry.line, column: entry.column },
      data: { provider: "arkui-sdk", component: entry.component ?? null },
    })
  }
}
```

In `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/definition.ts`, replace receiver lookup with:

```ts
const arkuiContext = findArkuiContext(content, position)
const entry = findArkuiApiDefinition(sdkPath, symbol, arkuiContext?.component)
```

- [x] **Step 5: Run semantic-worker tests**

Run:

```bash
pnpm --dir semantic-worker test
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add semantic-worker/src/features/arkui-context.ts semantic-worker/src/features/completion.ts semantic-worker/src/features/definition.ts semantic-worker/src/__tests__/completion.test.ts semantic-worker/src/__tests__/definition.test.ts
git commit -m "feat: detect arkui completion context"
```

## Task 5: Accept Exact Replacement Ranges In The Frontend

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Add failing frontend insertion test**

Add to `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx` near completion tests:

```tsx
it("uses completion replacement ranges when accepting SDK attributes", async () => {
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
    openFile: async () => [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Column() {",
      "      Text(\"Hi\")",
      "    }",
      "    .wi",
      "  }",
      "}",
    ].join("\n"),
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => ({ tools: [] }),
    completeSymbol: vi.fn(async () => [{
      label: "width",
      detail: "width(value: Length): T",
      kind: "method",
      insertText: "width(${1:value})",
      filterText: "width",
      source: "arkui",
      replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
      definitionTarget: { path: "C:/HarmonyOS/Sdk/ets/component/common.d.ts", line: 20927, column: 5 },
    }]),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  const editor = await screen.findByLabelText("Editor Content");
  await user.click(editor);
  await user.keyboard("{Control>} {/Control}");
  const popup = await screen.findByRole("listbox", { name: "Code Completion" });
  await user.click(within(popup).getByRole("option", { name: /width/ }));

  expect(editor).toHaveTextContent("Column() {Text(\"Hi\")}.width(value)");
});
```

- [x] **Step 2: Run failing test**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "replacement ranges"
```

Expected: FAIL because `insertCompletion` only replaces `completionReplacePrefix.length`.

- [x] **Step 3: Convert snippets to plain insertion text**

In `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`, add:

```ts
function plainCompletionInsertText(value: string) {
  return value
    .replace(/\$\{\d+:([^}]+)\}/g, "$1")
    .replace(/\$\d+/g, "");
}
```

- [x] **Step 4: Use replacementRange when accepting completion**

Change `insertCompletion(label: string)` to accept a presentation item:

```ts
function insertCompletionItem(item: CompletionPresentation) {
  completionRequestRef.current += 1;
  completionRecencyCounterRef.current += 1;
  completionRecencyRef.current.set(item.label, completionRecencyCounterRef.current);
  const text = plainCompletionInsertText(item.insertText);
  const replaceBefore = item.replacementRange
    ? Math.max(0, editorSelection.column - item.replacementRange.startColumn)
    : completionReplacePrefix.length;
  setInsertTextTarget({ text, replaceBefore, nonce: Date.now() });
  setCompletionItems([]);
  setCompletionReplacePrefix("");
  setCompletionSelectedIndex(0);
  setCompletionStatus("empty");
  setCompletionMessage(undefined);
  setActiveOverlay("none");
  setEditorFocusToken((token) => token + 1);
  setStatusText(`Inserted completion: ${item.label}`);
  focusEditorSoon();
}
```

Update accept sites:

```tsx
onAccept={(item) => insertCompletionItem(item)}
```

and keyboard accept:

```ts
if (selectedCompletionPresentation) {
  insertCompletionItem(selectedCompletionPresentation);
}
```

- [x] **Step 5: Run frontend completion tests**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "completion"
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: apply completion replacement ranges"
```

## Task 6: Show SDK Detail And Definition Identity In Completion Popup

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/CompletionPopup.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Add failing detail display test**

Add to `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`:

```tsx
it("shows SDK completion signature and source details", async () => {
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
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => ({ tools: [] }),
    completeSymbol: vi.fn(async () => [{
      label: "width",
      detail: "width(value: Length): T",
      kind: "method",
      insertText: "width(${1:value})",
      filterText: "width",
      source: "arkui",
      documentation: "Sets the width of the component.",
      definitionTarget: { path: "C:/HarmonyOS/Sdk/ets/component/common.d.ts", line: 20927, column: 5 },
    }]),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  const editor = await screen.findByLabelText("Editor Content");
  await user.click(editor);
  await user.keyboard("{Control>} {/Control}");

  const popup = await screen.findByRole("listbox", { name: "Code Completion" });
  expect(within(popup).getByText("width(value: Length): T")).toBeVisible();
  expect(within(popup).getByText("Sets the width of the component.")).toBeVisible();
  expect(within(popup).getByText(/common\.d\.ts:20927:5/)).toBeVisible();
});
```

- [x] **Step 2: Run failing test**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "SDK completion signature"
```

Expected: FAIL because popup details are hidden.

- [x] **Step 3: Enable compact details in popup**

In `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`, pass:

```tsx
detailsVisible={Boolean(selectedCompletionPresentation?.documentation || selectedCompletionPresentation?.definitionTarget)}
```

In `/Users/liuhui/Documents/code/ArkLine/src/components/layout/CompletionPopup.tsx`, change details body to:

```tsx
{detailsVisible && selectedItem ? (
  <div className="completion-popup__details">
    <div className="completion-popup__details-signature">{selectedItem.detail}</div>
    {selectedItem.documentation ? (
      <div className="completion-popup__details-doc">{selectedItem.documentation}</div>
    ) : null}
    {selectedItem.definitionTarget ? (
      <div className="completion-popup__details-source">
        {`${selectedItem.definitionTarget.path.split(/[\\/]/).at(-1)}:${selectedItem.definitionTarget.line}:${selectedItem.definitionTarget.column}`}
      </div>
    ) : null}
  </div>
) : null}
```

- [x] **Step 4: Add restrained CSS**

In `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`, update details styles:

```css
.completion-popup__details {
  margin: 4px;
  padding: 8px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: 1.4;
}

.completion-popup__details-signature {
  color: var(--text-primary);
  font-family: var(--font-code);
}

.completion-popup__details-doc,
.completion-popup__details-source {
  margin-top: 4px;
}

.completion-popup__details-source {
  color: var(--text-muted);
}
```

- [x] **Step 5: Run focused frontend tests**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "SDK completion signature|completion"
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/layout/CompletionPopup.tsx src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: show sdk completion details"
```

## Task 7: End-To-End `width` Quality Verification

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/definition.test.ts`

- [x] **Step 1: Add or update end-to-end tests for target user workflow**

Ensure these test names exist and pass:

```text
semantic worker completion > returns rich ArkUI width completion metadata
semantic worker completion > completes width in a multi-line ArkUI chain
semantic worker lifecycle > resolves width in a multi-line ArkUI chain
App shell > uses completion replacement ranges when accepting SDK attributes
App shell > shows SDK completion signature and source details
App shell > opens SDK declaration targets returned by go to definition
```

If any are missing, add them using the exact snippets from Tasks 3-6.

- [x] **Step 2: Run semantic worker tests**

Run:

```bash
pnpm --dir semantic-worker test
```

Expected: PASS.

- [x] **Step 3: Run frontend focused tests**

Run:

```bash
pnpm exec vitest run tests/frontend/completion-model.test.ts tests/frontend/app-shell.test.tsx --testNamePattern "completion|SDK declaration|replacement ranges|SDK completion signature"
```

Expected: PASS.

- [x] **Step 4: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml semantic_host
```

Expected: PASS.

- [x] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

```text
pnpm test: all Vitest suites pass
pnpm build: semantic-worker build, TypeScript checks, and Vite build pass
cargo test: all Rust/Tauri tests pass
```

- [x] **Step 6: Search for obsolete assumptions**

Run:

```bash
rg -n "label: string;\\s*detail: string;\\s*kind: string|insertCompletion\\(|Completion Overlay|Completion Query|width\\(value: Length\\): T" src semantic-worker src-tauri tests/frontend
```

Expected:

- no old-only completion item type remains
- no old completion overlay/query labels remain
- `width(value: Length): T` appears only in fixtures/tests/docs or SDK-derived details

- [x] **Step 7: Commit verification updates if tests changed**

If Step 1 or Step 6 required test/code cleanup:

```bash
git add semantic-worker/src/__tests__/completion.test.ts semantic-worker/src/__tests__/definition.test.ts tests/frontend/app-shell.test.tsx
git commit -m "test: verify arkui completion quality"
```

If no files changed, skip this commit.

## Execution Notes

- Keep compatibility with old `label/detail/kind` responses throughout. The app should not break if a mock or fallback provider returns only the original three fields.
- Do not add AI, inline completion, import insertion, or full signature help in this phase.
- Do not depend on DevEco Studio jars. Use SDK declaration and metadata files only.
- Preserve current settings-apply guard: completion and jump stay blocked while SDK settings are applying.
- Prefer semantic-worker tests for content correctness and frontend tests only for user-visible behavior.

## Self-Review

- Spec coverage:
  - Completion Protocol V2 minimal fields: Tasks 1 and 2.
  - Rich ArkUI SDK items: Task 3.
  - `width` multi-line completion and jump precision: Task 4.
  - Exact replacement range on accept: Task 5.
  - Signature/source/detail display: Task 6.
  - Full verification: Task 7.
- Scope:
  - This plan intentionally excludes AI, provider pipeline rewrite, import edits, and full signature-help UI.
  - The plan fixes the user-visible `width` class of issues while preparing the protocol for later industry-trend features.
- Type consistency:
  - `replacementRange` uses 1-based `startLine/startColumn/endLine/endColumn`, matching current editor line/column conventions.
  - `definitionTarget` reuses existing `DefinitionTarget`.
  - `insertText` may contain snippet placeholders in worker payloads; Task 5 strips placeholders to plain text until a true snippet engine exists.
