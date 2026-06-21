# ArkTS Semantic Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-provider ArkTS semantic layer to ArkLine so definition, completion, hover, document symbols, and usages can run through a real ArkTS SDK path when available and through an explicitly labeled fallback path otherwise.

**Architecture:** Introduce a Rust-side `SemanticProvider` / `SemanticRouter` boundary and move all semantic requests through it. Keep the frontend on one unified semantic API surface, with a visible mode badge and clear downgraded behavior when the real SDK-backed provider is unavailable.

**Tech Stack:** Tauri v2, Rust, React 19, TypeScript, CodeMirror 6, Vitest

---

### Task 1: Expand Semantic Models and Command Surface

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/language.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/commands/language.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/language-service-api.test.ts`

- [ ] **Step 1: Write the failing frontend API test for the richer semantic report and new symbol payloads**

```ts
it("reports semantic mode and capability truthfully outside Tauri", async () => {
  await expect(inspectLanguageService()).resolves.toEqual({
    provider: "mock-fallback",
    mode: "fallback",
    running: true,
    hover: true,
    definition: true,
    completion: true,
    documentSymbols: true,
    findUsages: true,
    detail: expect.stringContaining("fallback"),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- language-service-api`

Expected: FAIL because `mode`, `documentSymbols`, and `findUsages` are missing from the current payload shape.

- [ ] **Step 3: Add the new semantic DTOs and command signatures**

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServiceReport {
    pub provider: String,
    pub mode: String,
    pub running: bool,
    pub hover: bool,
    pub definition: bool,
    pub completion: bool,
    pub document_symbols: bool,
    pub find_usages: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSymbol {
    pub name: String,
    pub kind: String,
    pub line: u32,
    pub column: u32,
}
```

```rust
#[tauri::command]
pub fn document_symbols(
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<DocumentSymbol>, String> {
    Ok(document_symbols_impl(runtime.inner(), &request))
}

#[tauri::command]
pub fn find_usages(
    runtime: State<LanguageRuntime>,
    request: LanguageQueryRequest,
) -> Result<Vec<UsageResult>, String> {
    Ok(find_usages_impl(runtime.inner(), &request))
}
```

```ts
export type SemanticMode = "semantic" | "fallback" | "unavailable";

export type LanguageServiceReport = {
  provider: string;
  mode: SemanticMode;
  running: boolean;
  hover: boolean;
  definition: boolean;
  completion: boolean;
  documentSymbols: boolean;
  findUsages: boolean;
  detail: string;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- language-service-api`

Expected: PASS for the updated payload contract and command wiring.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models/language.rs src-tauri/src/commands/language.rs src/features/workspace/workspace-api.ts tests/frontend/language-service-api.test.ts
git commit -m "feat: expand semantic payload models and commands"
```

### Task 2: Introduce Rust SemanticProvider and SemanticRouter

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/mod.rs`
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/provider.rs`
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/router.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/language_service.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/lib.rs`
- Test: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/language_service.rs`

- [ ] **Step 1: Write the failing Rust test for router mode selection**

```rust
#[test]
fn reports_fallback_mode_when_no_sdk_provider_is_available() {
    let runtime = LanguageRuntime::default();
    let report = inspect_runtime(&runtime);

    assert_eq!(report.mode, "fallback");
    assert_eq!(report.provider, "fallback");
    assert!(report.definition);
    assert!(report.completion);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test reports_fallback_mode_when_no_sdk_provider_is_available`

Expected: FAIL because there is no router and the runtime still reports `provider = "none"`.

- [ ] **Step 3: Add provider trait and router skeleton**

```rust
pub trait SemanticProvider: Send + Sync {
    fn report(&self) -> LanguageServiceReport;
    fn hover(&self, request: &LanguageQueryRequest) -> Option<HoverResponse>;
    fn definition(&self, request: &LanguageQueryRequest) -> Option<DefinitionTarget>;
    fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem>;
    fn document_symbols(&self, request: &LanguageQueryRequest) -> Vec<DocumentSymbol>;
    fn usages(&self, request: &LanguageQueryRequest) -> Vec<UsageResult>;
}
```

```rust
pub struct SemanticRouter {
    fallback: Arc<dyn SemanticProvider>,
    semantic: Option<Arc<dyn SemanticProvider>>,
}

impl SemanticRouter {
    pub fn active(&self) -> &dyn SemanticProvider {
        self.semantic.as_deref().unwrap_or(self.fallback.as_ref())
    }
}
```

- [ ] **Step 4: Rewire LanguageRuntime to delegate through the router**

```rust
pub struct LanguageRuntime {
    router: SemanticRouter,
}

pub fn inspect_runtime(runtime: &LanguageRuntime) -> LanguageServiceReport {
    runtime.router.active().report()
}
```

- [ ] **Step 5: Run Rust tests to verify they pass**

Run: `cargo test`

Expected: PASS with the runtime now reporting fallback mode instead of the old empty skeleton.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/semantic src-tauri/src/services/language_service.rs src-tauri/src/lib.rs
git commit -m "feat: add semantic provider router skeleton"
```

### Task 3: Move Current Local Logic into FallbackProvider and Complete Fallback Features

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/fallback-symbols.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/local-definition.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/provider.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/language-service-api.test.ts`
- Create: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/fallback-symbols.test.ts`

- [ ] **Step 1: Write the failing fallback symbol test**

```ts
it("builds a document outline from ArkTS declarations", () => {
  const symbols = collectFallbackDocumentSymbols("struct Index {}\nfunction build() {}");
  expect(symbols).toEqual([
    { name: "Index", kind: "struct", line: 1, column: 8 },
    { name: "build", kind: "function", line: 2, column: 10 },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- fallback-symbols language-service-api`

Expected: FAIL because no fallback symbol collector exists yet.

- [ ] **Step 3: Add deterministic fallback helpers**

```ts
export function collectFallbackDocumentSymbols(content: string): DocumentSymbol[] {
  return content
    .split(/\r?\n/)
    .flatMap((lineText, index) => {
      const match = lineText.match(/\b(struct|class|interface|function)\s+([A-Za-z0-9_$]+)/);
      return match
        ? [{ name: match[2]!, kind: match[1]!, line: index + 1, column: lineText.indexOf(match[2]!) + 1 }]
        : [];
    });
}
```

```ts
export function collectFallbackCompletions(content: string): LanguageCompletionItem[] {
  return Array.from(new Set(content.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []))
    .slice(0, 50)
    .map((label) => ({ label, detail: "Fallback symbol", kind: "text" }));
}
```

- [ ] **Step 4: Wire workspace-api mock mode to the shared fallback helpers**

```ts
async documentSymbols(request) {
  const content = await this.openFile(request.path);
  return collectFallbackDocumentSymbols(content);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- fallback-symbols language-service-api local-definition`

Expected: PASS with fallback symbols and fallback-backed API behavior.

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/fallback-symbols.ts src/features/workspace/local-definition.ts src/features/workspace/workspace-api.ts tests/frontend/fallback-symbols.test.ts tests/frontend/language-service-api.test.ts
git commit -m "feat: complete fallback semantic helpers"
```

### Task 4: Add ArkTsLspProvider Discovery and Health Model

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/arkts_lsp_provider.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/router.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/environment_doctor.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/language.rs`
- Test: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/language_service.rs`

- [ ] **Step 1: Write the failing Rust test for no-SDK downgrade**

```rust
#[test]
fn keeps_fallback_active_when_sdk_discovery_fails() {
    let runtime = LanguageRuntime::default();
    let report = inspect_runtime(&runtime);

    assert_eq!(report.mode, "fallback");
    assert!(report.detail.contains("SDK"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test keeps_fallback_active_when_sdk_discovery_fails`

Expected: FAIL because the report detail does not yet describe semantic-provider discovery state.

- [ ] **Step 3: Add provider discovery and health reporting**

```rust
pub struct ArkTsLspProvider {
    status: ProviderStatus,
}

impl ArkTsLspProvider {
    pub fn discover() -> Result<Self, String> {
        Err("ArkTS SDK or language service not configured".to_string())
    }
}
```

```rust
impl SemanticRouter {
    pub fn new() -> Self {
        let semantic = ArkTsLspProvider::discover().ok().map(|provider| Arc::new(provider) as Arc<dyn SemanticProvider>);
        Self { fallback: Arc::new(FallbackProvider::default()), semantic }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test`

Expected: PASS with router health and discovery state surfaced through the language report.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/semantic/arkts_lsp_provider.rs src-tauri/src/services/semantic/router.rs src-tauri/src/services/environment_doctor.rs src-tauri/src/models/language.rs
git commit -m "feat: add ArkTS semantic provider discovery state"
```

### Task 5: Expose Semantic Mode in the Frontend and Label Fallback Results

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src/features/semantic/semantic-store.ts`
- Create: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/SemanticModeBadge.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing shell test for the semantic mode badge**

```tsx
it("shows fallback semantic mode in the status bar", async () => {
  render(<AppShell workspaceApi={fallbackApi} />);
  expect(await screen.findByText("Fallback")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- app-shell`

Expected: FAIL because no semantic badge is currently rendered.

- [ ] **Step 3: Add semantic state and status UI**

```ts
export type SemanticState = {
  provider: string;
  mode: SemanticMode;
  detail: string;
};
```

```tsx
export function SemanticModeBadge({ mode }: { mode: SemanticMode }) {
  return <span className={`semantic-mode-badge semantic-mode-${mode}`}>{mode === "semantic" ? "ArkTS Semantic" : mode === "fallback" ? "Fallback" : "Unavailable"}</span>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- app-shell language-service-api`

Expected: PASS with visible mode status and no regression to shell behavior.

- [ ] **Step 5: Commit**

```bash
git add src/features/semantic/semantic-store.ts src/components/layout/SemanticModeBadge.tsx src/components/layout/AppShell.tsx src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: expose semantic provider mode in UI"
```

### Task 6: Real ArkTS Provider Request Wiring and Sample-Project Validation

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/arkts_lsp_provider.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/semantic/provider.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/README.md`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/language-service-api.test.ts`

- [ ] **Step 1: Write the failing integration-style test for semantic mode preference**

```ts
it("prefers semantic provider payloads when the host reports semantic mode", async () => {
  await expect(inspectLanguageService()).resolves.toEqual(
    expect.objectContaining({ mode: "semantic" })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- language-service-api`

Expected: FAIL until the real provider handshake exists and returns semantic mode.

- [ ] **Step 3: Implement LSP-backed request forwarding**

```rust
impl SemanticProvider for ArkTsLspProvider {
    fn definition(&self, request: &LanguageQueryRequest) -> Option<DefinitionTarget> {
        self.client.goto_definition(request).ok().flatten()
    }
}
```

```rust
fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem> {
    self.client.complete(request).unwrap_or_default()
}
```

- [ ] **Step 4: Run verification across automated and manual checks**

Run: `cargo test`

Run: `pnpm test -- language-service-api app-shell`

Manual sample-project smoke:
- open a real small ArkTS workspace
- trigger `Ctrl+Click`
- trigger `Ctrl+Space`
- hover a symbol
- open document symbols
- run usages on a symbol referenced across files

Expected: automated suites PASS and the real project uses `semantic` mode for all five target capabilities.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/semantic/arkts_lsp_provider.rs src-tauri/src/services/semantic/provider.rs src/features/workspace/workspace-api.ts README.md
git commit -m "feat: wire ArkTS semantic provider through real workspace flows"
```

## Self-Review

- Spec coverage: provider boundary, fallback honesty, real SDK path, mode badge, retry-ready semantic health model, and five target capabilities each map to a task above.
- Placeholder scan: no `TBD`, `TODO`, or cross-task "same as above" shortcuts remain.
- Type consistency: this plan consistently uses `SemanticMode`, `LanguageServiceReport`, `DocumentSymbol`, and `UsageResult` as the public semantic payloads.
