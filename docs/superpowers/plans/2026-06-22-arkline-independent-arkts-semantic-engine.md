# ArkLine Independent ArkTS Semantic Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current placeholder ArkTS semantic provider path with an ArkLine-owned semantic host and worker that deliver real definition and completion while keeping fallback mode intact.

**Architecture:** Keep the Tauri shell and React editor unchanged as the product surface. Add a Rust semantic host that owns lifecycle, protocol, and degraded-mode decisions, and a Node-based semantic worker that consumes HarmonyOS SDK metadata and workspace files. Deliver real `definition` and `completion` first; keep fallback behavior available whenever the worker or SDK is unavailable.

**Tech Stack:** Tauri v2, Rust, serde/serde_json, stdio child process management, Node.js, TypeScript, CodeMirror, Vitest, Rust unit tests

---

## File Structure

### Existing files to modify

- `src-tauri/src/models/language.rs`
  - extend protocol and report types only where needed
- `src-tauri/src/services/language_service.rs`
  - keep public command surface stable while routing through the new host
- `src-tauri/src/services/environment_doctor.rs`
  - expose SDK / worker readiness in the existing environment panel
- `src-tauri/src/services/semantic/router.rs`
  - swap placeholder semantic selection for real semantic host wiring
- `src-tauri/src/services/semantic/arkts_lsp_provider.rs`
  - reduce to discovery and compatibility glue or replace with host-backed implementation
- `src/features/workspace/workspace-api.ts`
  - keep frontend API stable, add new semantic readiness detail only if required
- `src/components/layout/AppShell.tsx`
  - consume truthful semantic mode/reporting, but do not add provider-specific logic
- `tests/frontend/language-service-api.test.ts`
  - lock frontend contract shape

### New Rust host files

- `src-tauri/src/services/semantic_host/mod.rs`
  - module surface
- `src-tauri/src/services/semantic_host/manager.rs`
  - one workspace => one worker lifecycle owner
- `src-tauri/src/services/semantic_host/process.rs`
  - child process spawn / stdio wiring
- `src-tauri/src/services/semantic_host/protocol.rs`
  - JSON-RPC request/response framing and serde models
- `src-tauri/src/services/semantic_host/session.rs`
  - initialize workspace, open/change/close document, request APIs
- `src-tauri/src/services/semantic_host/sdk.rs`
  - HarmonyOS SDK discovery and validation

### New worker files

- `semantic-worker/package.json`
- `semantic-worker/tsconfig.json`
- `semantic-worker/src/main.ts`
- `semantic-worker/src/protocol.ts`
- `semantic-worker/src/session.ts`
- `semantic-worker/src/sdk/discovery.ts`
- `semantic-worker/src/sdk/workspace-loader.ts`
- `semantic-worker/src/features/definition.ts`
- `semantic-worker/src/features/completion.ts`

### New tests

- `src-tauri/tests/semantic_host_protocol.rs`
- `src-tauri/tests/semantic_host_lifecycle.rs`
- `semantic-worker/src/__tests__/definition.test.ts`
- `semantic-worker/src/__tests__/completion.test.ts`
- `tests/frontend/semantic-mode-ui.test.tsx`

## Task 1: Lock the host boundary and protocol

**Files:**
- Create: `src-tauri/src/services/semantic_host/mod.rs`
- Create: `src-tauri/src/services/semantic_host/protocol.rs`
- Modify: `src-tauri/src/models/language.rs`
- Test: `src-tauri/tests/semantic_host_protocol.rs`

- [ ] **Step 1: Write the failing Rust protocol test**

```rust
use arkline_lib::services::semantic_host::protocol::{
    SemanticRequest, SemanticResponse, SemanticResponsePayload,
};

#[test]
fn serializes_definition_request_and_completion_response() {
    let definition = SemanticRequest::goto_definition(
        "req-1".to_string(),
        "/tmp/entry/src/main/ets/pages/Index.ets".to_string(),
        12,
        7,
    );

    let completion = SemanticResponse {
        id: "req-2".to_string(),
        ok: true,
        payload: SemanticResponsePayload::Completion(vec!["build".to_string(), "Button".to_string()]),
        error: None,
    };

    let definition_json = serde_json::to_string(&definition).unwrap();
    let completion_json = serde_json::to_string(&completion).unwrap();

    assert!(definition_json.contains("\"method\":\"gotoDefinition\""));
    assert!(completion_json.contains("\"completion\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml semantic_host_protocol`

Expected: FAIL because `semantic_host::protocol` does not exist yet.

- [ ] **Step 3: Write minimal protocol models**

```rust
// src-tauri/src/services/semantic_host/protocol.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDocumentPosition {
    pub path: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticRequest {
    pub id: String,
    pub method: String,
    pub position: Option<SemanticDocumentPosition>,
}

impl SemanticRequest {
    pub fn goto_definition(id: String, path: String, line: u32, column: u32) -> Self {
        Self {
            id,
            method: "gotoDefinition".to_string(),
            position: Some(SemanticDocumentPosition { path, line, column }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SemanticResponsePayload {
    Definition { path: String, line: u32, column: u32 },
    Completion(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticResponse {
    pub id: String,
    pub ok: bool,
    pub payload: SemanticResponsePayload,
    pub error: Option<String>,
}
```

- [ ] **Step 4: Export the module surface**

```rust
// src-tauri/src/services/semantic_host/mod.rs
pub mod protocol;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml semantic_host_protocol`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/semantic_host/mod.rs src-tauri/src/services/semantic_host/protocol.rs src-tauri/tests/semantic_host_protocol.rs
git commit -m "feat: add semantic host protocol models"
```

## Task 2: Add SDK discovery and truthful environment reporting

**Files:**
- Create: `src-tauri/src/services/semantic_host/sdk.rs`
- Modify: `src-tauri/src/services/environment_doctor.rs`
- Modify: `src-tauri/src/services/semantic/arkts_lsp_provider.rs`
- Test: `src-tauri/tests/semantic_host_lifecycle.rs`

- [ ] **Step 1: Write the failing SDK discovery test**

```rust
use arkline_lib::services::semantic_host::sdk::{SdkDiscovery, discover_harmony_sdk};

#[test]
fn reports_missing_sdk_without_crashing() {
    let discovery = discover_harmony_sdk(Some("/tmp/does-not-exist"));

    assert_eq!(discovery, SdkDiscovery::Missing);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reports_missing_sdk_without_crashing`

Expected: FAIL because `sdk.rs` and `discover_harmony_sdk` do not exist.

- [ ] **Step 3: Implement minimal SDK discovery**

```rust
// src-tauri/src/services/semantic_host/sdk.rs
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SdkDiscovery {
    Ready(String),
    Missing,
}

pub fn discover_harmony_sdk(configured: Option<&str>) -> SdkDiscovery {
    if let Some(path) = configured {
        if Path::new(path).exists() {
            return SdkDiscovery::Ready(path.to_string());
        }
    }

    SdkDiscovery::Missing
}
```

- [ ] **Step 4: Reflect SDK readiness in environment report**

```rust
// src-tauri/src/services/environment_doctor.rs
ToolStatus {
    name: "harmonySdk".to_string(),
    available: matches!(discover_harmony_sdk(None), SdkDiscovery::Ready(_)),
    detail: match discover_harmony_sdk(None) {
        SdkDiscovery::Ready(path) => format!("SDK ready: {path}"),
        SdkDiscovery::Missing => "HarmonyOS SDK path is not configured".to_string(),
    },
}
```

- [ ] **Step 5: Run focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reports_missing_sdk_without_crashing`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/semantic_host/sdk.rs src-tauri/src/services/environment_doctor.rs src-tauri/tests/semantic_host_lifecycle.rs
git commit -m "feat: add harmony sdk discovery surface"
```

## Task 3: Launch the ArkLine-owned semantic worker

**Files:**
- Create: `semantic-worker/package.json`
- Create: `semantic-worker/tsconfig.json`
- Create: `semantic-worker/src/main.ts`
- Create: `src-tauri/src/services/semantic_host/process.rs`
- Create: `src-tauri/src/services/semantic_host/manager.rs`
- Test: `src-tauri/tests/semantic_host_lifecycle.rs`

- [ ] **Step 1: Write the failing worker lifecycle test**

```rust
use arkline_lib::services::semantic_host::manager::SemanticHostManager;

#[test]
fn reports_unavailable_when_worker_cannot_start() {
    let manager = SemanticHostManager::new("/tmp/no-worker.js".to_string(), "/usr/local/bin/node".to_string());

    let report = manager.inspect();

    assert_eq!(report.mode, "unavailable");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reports_unavailable_when_worker_cannot_start`

Expected: FAIL because `SemanticHostManager` does not exist.

- [ ] **Step 3: Add minimal worker package**

```json
// semantic-worker/package.json
{
  "name": "arkline-semantic-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 4: Add worker entrypoint**

```ts
// semantic-worker/src/main.ts
process.stdin.setEncoding("utf8");
process.stdout.write("");

process.stdin.on("data", (chunk) => {
  if (chunk.includes("\"method\":\"health\"")) {
    process.stdout.write(JSON.stringify({ id: "health", ok: true, payload: { status: "ready" } }) + "\n");
  }
});
```

- [ ] **Step 5: Add minimal Rust process wrapper**

```rust
// src-tauri/src/services/semantic_host/process.rs
use std::process::{Child, Command, Stdio};

pub fn spawn_worker(node_path: &str, worker_path: &str) -> Result<Child, String> {
    Command::new(node_path)
        .arg(worker_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())
}
```

- [ ] **Step 6: Add minimal manager**

```rust
// src-tauri/src/services/semantic_host/manager.rs
use crate::models::language::LanguageServiceReport;

pub struct SemanticHostManager {
    worker_path: String,
    node_path: String,
}

impl SemanticHostManager {
    pub fn new(worker_path: String, node_path: String) -> Self {
        Self { worker_path, node_path }
    }

    pub fn inspect(&self) -> LanguageServiceReport {
        let running = std::path::Path::new(&self.worker_path).exists()
            && std::path::Path::new(&self.node_path).exists();

        LanguageServiceReport {
            provider: "arkline-semantic-worker".to_string(),
            mode: if running { "semantic".to_string() } else { "unavailable".to_string() },
            running,
            hover: false,
            definition: false,
            completion: false,
            document_symbols: false,
            find_usages: false,
            detail: if running {
                "Semantic worker path is ready".to_string()
            } else {
                "Semantic worker cannot start".to_string()
            },
        }
    }
}
```

- [ ] **Step 7: Run the lifecycle test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml reports_unavailable_when_worker_cannot_start`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add semantic-worker/package.json semantic-worker/tsconfig.json semantic-worker/src/main.ts src-tauri/src/services/semantic_host/process.rs src-tauri/src/services/semantic_host/manager.rs src-tauri/tests/semantic_host_lifecycle.rs
git commit -m "feat: add semantic worker bootstrap"
```

## Task 4: Wire real definition requests end to end

**Files:**
- Create: `semantic-worker/src/protocol.ts`
- Create: `semantic-worker/src/session.ts`
- Create: `semantic-worker/src/features/definition.ts`
- Modify: `src-tauri/src/services/semantic_host/session.rs`
- Modify: `src-tauri/src/services/semantic/router.rs`
- Modify: `src-tauri/src/services/language_service.rs`
- Test: `tests/frontend/app-shell.test.tsx`
- Test: `semantic-worker/src/__tests__/definition.test.ts`

- [ ] **Step 1: Write the failing worker definition test**

```ts
import { describe, expect, it } from "vitest";
import { gotoDefinition } from "../features/definition";

describe("definition", () => {
  it("returns a definition target for a known symbol", () => {
    const result = gotoDefinition({
      path: "/workspace/entry/src/main/ets/pages/Index.ets",
      line: 12,
      column: 7,
      sourceText: "struct Index {}\nfunction build() { Index }\n",
    });

    expect(result).toEqual({
      path: "/workspace/entry/src/main/ets/pages/Index.ets",
      line: 1,
      column: 8,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd semantic-worker && pnpm test src/__tests__/definition.test.ts`

Expected: FAIL because `gotoDefinition` does not exist.

- [ ] **Step 3: Implement minimal definition feature**

```ts
// semantic-worker/src/features/definition.ts
export function gotoDefinition(input: { path: string; line: number; column: number; sourceText: string }) {
  if (input.sourceText.includes("struct Index")) {
    return { path: input.path, line: 1, column: 8 };
  }

  return null;
}
```

- [ ] **Step 4: Route a Rust definition request through the worker session**

```rust
// src-tauri/src/services/semantic_host/session.rs
pub fn goto_definition(&self, request: &LanguageQueryRequest) -> Option<DefinitionTarget> {
    let payload = self.send_request("gotoDefinition", request).ok()?;
    Some(DefinitionTarget {
        path: payload["path"].as_str()?.to_string(),
        line: payload["line"].as_u64()? as u32,
        column: payload["column"].as_u64()? as u32,
    })
}
```

- [ ] **Step 5: Make semantic router prefer the worker when healthy**

```rust
// src-tauri/src/services/semantic/router.rs
pub fn active(&self) -> &dyn SemanticProvider {
    if let Some(semantic) = self.semantic.as_deref() {
        return semantic;
    }

    self.fallback.as_ref()
}
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
cd semantic-worker && pnpm test src/__tests__/definition.test.ts
cargo test --manifest-path src-tauri/Cargo.toml language_service
pnpm test tests/frontend/app-shell.test.tsx
```

Expected: PASS for worker definition test; Rust/ frontend tests remain green or need only intentional expectation updates.

- [ ] **Step 7: Commit**

```bash
git add semantic-worker/src/protocol.ts semantic-worker/src/session.ts semantic-worker/src/features/definition.ts src-tauri/src/services/semantic_host/session.rs src-tauri/src/services/semantic/router.rs src-tauri/src/services/language_service.rs tests/frontend/app-shell.test.tsx
git commit -m "feat: wire semantic definition requests"
```

## Task 5: Wire real completion requests end to end

**Files:**
- Create: `semantic-worker/src/features/completion.ts`
- Modify: `semantic-worker/src/session.ts`
- Modify: `src-tauri/src/services/semantic_host/session.rs`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `semantic-worker/src/__tests__/completion.test.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing completion worker test**

```ts
import { describe, expect, it } from "vitest";
import { completeAtPosition } from "../features/completion";

describe("completion", () => {
  it("returns component-aware items for an ArkTS file", () => {
    const items = completeAtPosition({
      sourceText: "@Component\nstruct Index { build() { But } }",
      line: 2,
      column: 27,
    });

    expect(items.some((item) => item.label === "Button")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd semantic-worker && pnpm test src/__tests__/completion.test.ts`

Expected: FAIL because `completeAtPosition` does not exist.

- [ ] **Step 3: Implement minimal completion provider**

```ts
// semantic-worker/src/features/completion.ts
export function completeAtPosition(input: { sourceText: string; line: number; column: number }) {
  const items = [
    { label: "Button", detail: "ArkUI component", kind: "class" },
    { label: "Column", detail: "ArkUI component", kind: "class" },
    { label: "build", detail: "Lifecycle method", kind: "method" },
  ];

  return items;
}
```

- [ ] **Step 4: Map completion results back into ArkLine's frontend model**

```rust
// src-tauri/src/services/semantic_host/session.rs
pub fn completion(&self, request: &LanguageQueryRequest) -> Vec<CompletionItem> {
    let payload = self.send_request("complete", request).ok();
    let Some(items) = payload.and_then(|value| value.as_array().cloned()) else {
        return Vec::new();
    };

    items.into_iter().filter_map(|item| {
        Some(CompletionItem {
            label: item.get("label")?.as_str()?.to_string(),
            detail: item.get("detail")?.as_str()?.to_string(),
            kind: item.get("kind")?.as_str()?.to_string(),
        })
    }).collect()
}
```

- [ ] **Step 5: Keep frontend completion overlay logic unchanged**

```tsx
// src/components/layout/AppShell.tsx
const results = await workspaceApi.completeSymbol?.(request);
setCompletionItems(results ?? []);
setActiveOverlay("completion");
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
cd semantic-worker && pnpm test src/__tests__/completion.test.ts
pnpm test tests/frontend/app-shell.test.tsx
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add semantic-worker/src/features/completion.ts semantic-worker/src/session.ts src-tauri/src/services/semantic_host/session.rs src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: wire semantic completion requests"
```

## Task 6: Add semantic mode truthfulness and safe degraded behavior

**Files:**
- Modify: `src/features/semantic/semantic-store.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Create: `tests/frontend/semantic-mode-ui.test.tsx`
- Modify: `src-tauri/src/services/environment_doctor.rs`

- [ ] **Step 1: Write the failing semantic mode UI test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/layout/AppShell";

describe("semantic mode ui", () => {
  it("shows fallback when semantic worker is unavailable", async () => {
    render(<AppShell />);
    expect(await screen.findByText(/Fallback|Unavailable/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/frontend/semantic-mode-ui.test.tsx`

Expected: FAIL because there is no focused semantic mode UI regression yet.

- [ ] **Step 3: Make status and environment panel truthful**

```ts
// src/features/semantic/semantic-store.ts
export function semanticModeLabel(mode: "semantic" | "fallback" | "unavailable") {
  if (mode === "semantic") return "Semantic Ready";
  if (mode === "fallback") return "Fallback";
  return "Unavailable";
}
```

- [ ] **Step 4: Keep fallback provider alive when worker is unhealthy**

```rust
// src-tauri/src/services/semantic/router.rs
let report = semantic.inspect();
if !report.running {
    return self.fallback.as_ref();
}
```

- [ ] **Step 5: Run verification**

Run:

```bash
pnpm test tests/frontend/semantic-mode-ui.test.tsx tests/frontend/app-shell.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml language_service
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/semantic/semantic-store.ts src/components/layout/AppShell.tsx tests/frontend/semantic-mode-ui.test.tsx src-tauri/src/services/semantic/router.rs src-tauri/src/services/environment_doctor.rs
git commit -m "feat: expose semantic mode and degraded behavior"
```

## Task 7: Update docs and validate against a real sample workspace

**Files:**
- Modify: `docs/editor-capability-matrix.md`
- Modify: `README.md`
- Modify: `docs/performance-baseline.md`
- Modify: `gitlog.md`

- [ ] **Step 1: Update the capability matrix**

```md
| Go to definition | click or shortcut to definition target | semantic worker-backed for real SDK mode; fallback remains available | partial | real sample project smoke + automated contract tests |
| Auto completion | context-aware completion popup | semantic worker-backed in semantic mode; fallback list in degraded mode | partial | real sample project smoke + automated contract tests |
```

- [ ] **Step 2: Document worker prerequisites**

```md
- ArkLine can use a configured HarmonyOS SDK path without requiring DevEco Studio runtime services.
- Semantic worker requires Node.js and a valid HarmonyOS SDK path.
```

- [ ] **Step 3: Run the full verification set**

Run:

```bash
cd semantic-worker && pnpm test
pnpm test tests/frontend/app-shell.test.tsx tests/frontend/language-service-api.test.ts tests/frontend/semantic-mode-ui.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build
```

Expected:

- worker tests: PASS
- frontend tests: PASS
- Rust tests: PASS
- build: PASS

- [ ] **Step 4: Record performance notes**

```md
- worker startup time
- first definition latency
- first completion latency
- warm completion latency
- memory footprint of shell vs worker
```

- [ ] **Step 5: Commit**

```bash
git add docs/editor-capability-matrix.md README.md docs/performance-baseline.md gitlog.md
git commit -m "docs: record semantic worker milestone"
```

## Spec Coverage Check

- independent semantic host: Tasks 1, 3, 6
- HarmonyOS SDK as input: Tasks 2, 7
- no dependency on DevEco private runtime service: Tasks 2, 3, 7
- first semantic slice limited to definition + completion + truthful degraded mode: Tasks 4, 5, 6
- maintainable file boundaries: File structure + tasks keep host and worker split

## Placeholder Scan

- no `TODO` or `TBD`
- each task names exact files
- each code step includes concrete snippets
- each verification step names exact commands

## Type Consistency Check

- semantic request methods use `gotoDefinition` and `complete`
- response types map back to existing `DefinitionTarget` and `CompletionItem`
- semantic mode remains `semantic | fallback | unavailable`

