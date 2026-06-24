# ArkLine ArkUI System API Semantic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SDK-backed ArkUI system API jump and completion for component attributes such as `width`.

**Architecture:** Keep the current semantic worker protocol. Add a cached ArkUI API index inside `semantic-worker`, populate it from HarmonyOS SDK component declaration files and component metadata JSON, then consult it from definition and completion resolution only when the editor context looks like ArkUI UI DSL.

**Tech Stack:** TypeScript semantic worker, Vitest, Rust semantic host integration tests, React/Vitest frontend tests.

---

## File Structure

- Create: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/sdk/arkui-api-index.ts`
  - Loads and caches ArkUI common/component attributes from SDK files.
  - Exposes definition and completion lookup helpers.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/document-analysis.ts`
  - Adds narrow method-member parsing for SDK `.d.ts` files.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/definition.ts`
  - Adds ArkUI API fallback after imported SDK lookup and before workspace-wide fallback.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/completion.ts`
  - Adds ArkUI context detection and system API completions.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/definition.test.ts`
  - Covers `.width()` definition.
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`
  - Covers common and component-specific completions.
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`
  - Covers SDK target opening and rendered completion items through the app shell.

## Task 1: Add ArkUI API Index

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/sdk/arkui-api-index.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/document-analysis.ts`
- Test: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/definition.test.ts`

- [ ] **Step 1: Add failing tests for SDK common attribute indexing**

Add this test helper to `semantic-worker/src/__tests__/definition.test.ts`:

```ts
function createArkuiSdkFixture(root: string): {
  sdkRoot: string
  commonPath: string
  componentsDir: string
} {
  const sdkRoot = path.join(root, "sdk", "openharmony")
  const componentDir = path.join(sdkRoot, "ets", "component")
  const componentsDir = path.join(sdkRoot, "ets", "build-tools", "ets-loader", "components")
  fs.mkdirSync(componentDir, { recursive: true })
  fs.mkdirSync(componentsDir, { recursive: true })
  fs.mkdirSync(path.join(sdkRoot, "ets"), { recursive: true })
  fs.mkdirSync(path.join(sdkRoot, "toolchains"), { recursive: true })

  const commonPath = path.join(componentDir, "common.d.ts")
  fs.writeFileSync(
    commonPath,
    [
      "declare class CommonMethod<T> {",
      "    /** Sets the width of the component. */",
      "    width(value: Length): T;",
      "    /** Sets the height of the component. */",
      "    height(value: Length): T;",
      "}",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(componentsDir, "common_attrs.json"),
    JSON.stringify({ attrs: ["width", "height"] }),
  )
  fs.writeFileSync(
    path.join(componentsDir, "column.json"),
    JSON.stringify({ name: "Column", attrs: ["justifyContent"] }),
  )

  return { sdkRoot, commonPath, componentsDir }
}
```

Add this failing test:

```ts
it("resolves ArkUI universal attributes from SDK component declarations", () => {
  const session = new SemanticWorkerSession()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-width-"))
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
      "    Column() {",
      "      Text(\"Hi\")",
      "    }",
      "    .width(100)",
      "  }",
      "}",
      "",
    ].join("\n"),
  )

  const response = session.handle({
    id: "definition-arkui-width",
    method: "gotoDefinition",
    position: { path: indexPath, line: 8, column: 8 },
  })

  expect(response.ok).toBe(true)
  expect(response.payload).toEqual({
    path: commonPath,
    line: 3,
    column: 5,
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir /Users/liuhui/Documents/code/ArkLine/semantic-worker test -- definition
```

Expected: FAIL because no ArkUI API index exists and `.width()` returns `null`.

- [ ] **Step 3: Implement method-member parsing**

In `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/document-analysis.ts`, add:

```ts
export interface DocumentMethodSymbol extends DocumentSymbol {
  signature: string
  detail: string
}

export function collectDocumentMethodSymbolsForPath(
  content: string,
  documentPath?: string,
): DocumentMethodSymbol[] {
  const lines = content.split(/\r?\n/)
  const symbols: DocumentMethodSymbol[] = []
  let lastDocSummary = ""

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? ""
    const summaryMatch = lineText.match(/^\s*\*\s+([^@].*?)\s*$/)
    if (summaryMatch?.[1]) {
      lastDocSummary = summaryMatch[1]
    }

    const methodMatch = lineText.match(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*:\s*([^;{]+);/)
    if (!methodMatch?.[2]) {
      continue
    }

    const name = methodMatch[2]
    symbols.push({
      path: documentPath,
      name,
      kind: "method",
      line: index + 1,
      column: lineText.indexOf(name) + 1,
      signature: lineText.trim(),
      detail: lastDocSummary,
    })
    lastDocSummary = ""
  }

  return symbols
}
```

- [ ] **Step 4: Implement `arkui-api-index.ts`**

Create `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/sdk/arkui-api-index.ts`:

```ts
import fs from "node:fs"
import path from "node:path"

import { collectDocumentMethodSymbolsForPath, readDocument } from "../features/document-analysis.js"

export type ArkuiApiEntry = {
  name: string
  kind: "universalAttribute" | "componentAttribute"
  component?: string
  path: string
  line: number
  column: number
  signature: string
  detail: string
}

type ComponentMetadata = {
  name?: string
  attrs?: string[]
}

const cache = new Map<string, ArkuiApiEntry[]>()

export function clearArkuiApiIndexCache(): void {
  cache.clear()
}

export function loadArkuiApiIndex(sdkRoot: string | undefined): ArkuiApiEntry[] {
  if (!sdkRoot) {
    return []
  }
  if (cache.has(sdkRoot)) {
    return cache.get(sdkRoot) ?? []
  }

  const entries = buildArkuiApiIndex(sdkRoot)
  cache.set(sdkRoot, entries)
  return entries
}

export function findArkuiApiDefinition(
  sdkRoot: string | undefined,
  name: string,
  component?: string | null,
): ArkuiApiEntry | null {
  const entries = loadArkuiApiIndex(sdkRoot)
  const componentMatch = component
    ? entries.find((entry) => entry.name === name && entry.component === component)
    : null
  return componentMatch
    ?? entries.find((entry) => entry.name === name && entry.kind === "universalAttribute")
    ?? entries.find((entry) => entry.name === name)
    ?? null
}

export function completeArkuiApis(
  sdkRoot: string | undefined,
  component?: string | null,
): ArkuiApiEntry[] {
  const entries = loadArkuiApiIndex(sdkRoot)
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (entry.component && entry.component !== component) {
      return false
    }
    if (seen.has(entry.name)) {
      return false
    }
    seen.add(entry.name)
    return true
  })
}

function buildArkuiApiIndex(sdkRoot: string): ArkuiApiEntry[] {
  const commonDeclarationPath = path.join(sdkRoot, "ets", "component", "common.d.ts")
  const commonMethods = collectMethods(commonDeclarationPath)
  const commonAttrs = readAttrs(path.join(sdkRoot, "ets", "build-tools", "ets-loader", "components", "common_attrs.json"))
  const entries: ArkuiApiEntry[] = commonAttrs.flatMap((name) => {
    const method = commonMethods.find((item) => item.name === name)
    return method ? [{
      name,
      kind: "universalAttribute" as const,
      path: method.path ?? commonDeclarationPath,
      line: method.line,
      column: method.column,
      signature: method.signature,
      detail: method.detail || "ArkUI universal attribute",
    }] : []
  })

  const componentsDir = path.join(sdkRoot, "ets", "build-tools", "ets-loader", "components")
  for (const metadataPath of listJsonFiles(componentsDir)) {
    if (path.basename(metadataPath) === "common_attrs.json") {
      continue
    }
    const metadata = readComponentMetadata(metadataPath)
    if (!metadata.name || !metadata.attrs) {
      continue
    }
    const declarationPath = path.join(sdkRoot, "ets", "component", `${camelToSnake(metadata.name)}.d.ts`)
    const methods = collectMethods(declarationPath)
    for (const attr of metadata.attrs) {
      const method = methods.find((item) => item.name === attr)
      entries.push({
        name: attr,
        kind: "componentAttribute",
        component: metadata.name,
        path: method?.path ?? declarationPath,
        line: method?.line ?? 1,
        column: method?.column ?? 1,
        signature: method?.signature ?? `${attr}(...)`,
        detail: method?.detail ?? `ArkUI ${metadata.name} attribute`,
      })
    }
  }

  return entries
}

function collectMethods(filePath: string) {
  const content = readDocument(filePath)
  return content ? collectDocumentMethodSymbolsForPath(content, filePath) : []
}

function readAttrs(filePath: string): string[] {
  const metadata = readComponentMetadata(filePath)
  return metadata.attrs ?? []
}

function readComponentMetadata(filePath: string): ComponentMetadata {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ComponentMetadata
  } catch {
    return {}
  }
}

function listJsonFiles(directoryPath: string): string[] {
  try {
    return fs.readdirSync(directoryPath)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(directoryPath, name))
  } catch {
    return []
  }
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (match, index) => `${index === 0 ? "" : "_"}${match.toLowerCase()}`)
}
```

- [ ] **Step 5: Run method parser unit through existing worker tests**

Run:

```bash
pnpm --dir /Users/liuhui/Documents/code/ArkLine/semantic-worker test -- definition
```

Expected: still FAIL until definition resolution uses the index, but TypeScript compilation should pass if the new module types are correct.

## Task 2: Resolve ArkUI Attribute Definitions

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/definition.ts`
- Test: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/definition.test.ts`

- [ ] **Step 1: Add ArkUI receiver/component helper**

In `semantic-worker/src/features/definition.ts`, add:

```ts
function componentReceiverBeforeSymbol(content: string, position: SemanticDocumentPosition | undefined): string | null {
  if (!position) {
    return null
  }
  const lines = content.split(/\r?\n/)
  const lineText = lines[position.line - 1] ?? ""
  const before = lineText.slice(0, Math.max(position.column - 1, 0))
  const receiverMatch = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*$/)
  return receiverMatch?.[1] ?? null
}
```

- [ ] **Step 2: Wire ArkUI index after imported SDK lookup**

In `resolveDefinitionCandidates`, after `importedSdkDefinitions` and before `workspaceDefinitions`, add:

```ts
  const arkuiDefinition = resolveArkuiSystemAttribute(
    currentDocument.content,
    position,
    symbol,
  )
  if (arkuiDefinition) {
    return [arkuiDefinition]
  }
```

Add:

```ts
function resolveArkuiSystemAttribute(
  content: string,
  position: SemanticDocumentPosition,
  symbol: string,
): SemanticDefinitionCandidate | null {
  const sdkPath = discoverHarmonySdk().path
  if (!sdkPath) {
    return null
  }
  const component = componentReceiverBeforeSymbol(content, position)
  const entry = findArkuiApiDefinition(sdkPath, symbol, component)
  if (!entry) {
    return null
  }
  return {
    path: entry.path,
    line: entry.line,
    column: entry.column,
  }
}
```

Import `findArkuiApiDefinition` from `../sdk/arkui-api-index.js`.

- [ ] **Step 3: Run definition tests**

Run:

```bash
pnpm --dir /Users/liuhui/Documents/code/ArkLine/semantic-worker test -- definition
```

Expected: PASS, including the new `.width()` SDK definition test.

- [ ] **Step 4: Add regression for local priority**

Add this test to `definition.test.ts`:

```ts
it("keeps current document definitions ahead of ArkUI system attributes", () => {
  const session = new SemanticWorkerSession()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-local-width-"))
  tempRoots.push(root)
  const { sdkRoot } = createArkuiSdkFixture(root)
  process.env.ARKLINE_HARMONY_SDK_PATH = sdkRoot

  const pagesDir = path.join(root, "entry", "src", "main", "ets", "pages")
  fs.mkdirSync(pagesDir, { recursive: true })
  const indexPath = path.join(pagesDir, "Index.ets")
  fs.writeFileSync(
    indexPath,
    [
      "function width() { return 1; }",
      "function run() {",
      "  width()",
      "}",
      "",
    ].join("\n"),
  )

  const response = session.handle({
    id: "definition-local-width",
    method: "gotoDefinition",
    position: { path: indexPath, line: 3, column: 4 },
  })

  expect(response.payload).toEqual({
    path: indexPath,
    line: 1,
    column: 10,
  })
})
```

- [ ] **Step 5: Run definition tests again**

Run:

```bash
pnpm --dir /Users/liuhui/Documents/code/ArkLine/semantic-worker test -- definition
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  semantic-worker/src/sdk/arkui-api-index.ts \
  semantic-worker/src/features/document-analysis.ts \
  semantic-worker/src/features/definition.ts \
  semantic-worker/src/__tests__/definition.test.ts
git -C /Users/liuhui/Documents/code/ArkLine commit -m "feat: resolve arkui system api definitions"
```

## Task 3: Add ArkUI Component Completion

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/features/completion.ts`
- Test: `/Users/liuhui/Documents/code/ArkLine/semantic-worker/src/__tests__/completion.test.ts`

- [ ] **Step 1: Add failing completion tests**

In `semantic-worker/src/__tests__/completion.test.ts`, add SDK fixture equivalent to Task 1 or import a shared local helper if the test file already has one.

Add:

```ts
it("includes ArkUI common and component attributes after a component chain", () => {
  const session = new SemanticWorkerSession()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arkline-worker-arkui-completion-"))
  tempRoots.push(root)
  const { sdkRoot } = createArkuiSdkFixture(root)
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
      "    }.",
      "  }",
      "}",
      "",
    ].join("\n"),
  )

  const response = session.handle({
    id: "completion-arkui-column",
    method: "completion",
    position: { path: indexPath, line: 6, column: 7 },
  })

  expect(response.payload).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "width", detail: expect.stringContaining("Length"), kind: "method" }),
    expect.objectContaining({ label: "justifyContent", detail: expect.stringContaining("Column"), kind: "method" }),
  ]))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir /Users/liuhui/Documents/code/ArkLine/semantic-worker test -- completion
```

Expected: FAIL because completion does not read ArkUI index.

- [ ] **Step 3: Implement ArkUI completion context**

In `semantic-worker/src/features/completion.ts`, add:

```ts
import { discoverHarmonySdk } from "../sdk/discovery.js"
import { completeArkuiApis } from "../sdk/arkui-api-index.js"

function arkuiCompletionComponent(content: string, position: SemanticDocumentPosition): string | null {
  const lineText = content.split(/\r?\n/)[position.line - 1] ?? ""
  const before = lineText.slice(0, Math.max(position.column - 1, 0))
  const match = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\.\s*[A-Za-z_$]*$/)
  return match?.[1] ?? null
}
```

Before returning `labels`, add:

```ts
  const component = arkuiCompletionComponent(content, position)
  if (component) {
    const sdkPath = discoverHarmonySdk().path
    for (const entry of completeArkuiApis(sdkPath, component)) {
      push(entry.name, entry.signature || entry.detail, "method")
    }
  }
```

- [ ] **Step 4: Run completion tests**

Run:

```bash
pnpm --dir /Users/liuhui/Documents/code/ArkLine/semantic-worker test -- completion
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  semantic-worker/src/features/completion.ts \
  semantic-worker/src/__tests__/completion.test.ts
git -C /Users/liuhui/Documents/code/ArkLine commit -m "feat: complete arkui system api attributes"
```

## Task 4: Frontend and Host Regression Coverage

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/language_service.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Add Rust host regression using mock worker**

In `src-tauri/src/services/language_service.rs`, add a test that uses the existing `mock_worker_entry` helper to return a definition path under a fake SDK declaration file and asserts `goto_definition` forwards it unchanged. Reuse the existing `with_worker_settings` pattern.

Expected assertion:

```rust
assert_eq!(
    goto_definition(&runtime, &settings, &request(&index_text, 8, 8)),
    Some(DefinitionTarget {
        path: sdk_common_path.to_string_lossy().to_string(),
        line: 3,
        column: 5,
    })
);
```

- [ ] **Step 2: Add frontend AppShell test**

Add an AppShell test where `workspaceApi.gotoDefinition` returns:

```ts
{
  path: "C:/HarmonyOS/Sdk/ets/component/common.d.ts",
  line: 3,
  column: 5,
}
```

Assert:

```ts
expect(await screen.findByRole("button", { name: "common.d.ts", pressed: true })).toBeVisible()
expect(await screen.findByLabelText("Editor Content")).toHaveTextContent("width(value: Length): T")
```

- [ ] **Step 3: Run targeted tests**

Run:

```bash
cargo test --manifest-path /Users/liuhui/Documents/code/ArkLine/src-tauri/Cargo.toml language_service
pnpm -C /Users/liuhui/Documents/code/ArkLine exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "definition|completion|Settings"
```

Expected: PASS.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm -C /Users/liuhui/Documents/code/ArkLine test
pnpm -C /Users/liuhui/Documents/code/ArkLine build
cargo test --manifest-path /Users/liuhui/Documents/code/ArkLine/src-tauri/Cargo.toml
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/liuhui/Documents/code/ArkLine add \
  src-tauri/src/services/language_service.rs \
  tests/frontend/app-shell.test.tsx
git -C /Users/liuhui/Documents/code/ArkLine commit -m "test: cover arkui sdk semantic integration"
```

## Plan Self-Review

- Spec coverage: The plan covers SDK indexing, method parsing, definition resolution, completion resolution, frontend integration, graceful SDK absence, and regression verification.
- Placeholder scan: No implementation step uses unresolved placeholders.
- Type consistency: The `ArkuiApiEntry` shape is consistent across index, definition, and completion tasks.
- Scope check: This is one vertical feature centered on ArkUI system API semantic support; no unrelated UI or terminal work is included.
