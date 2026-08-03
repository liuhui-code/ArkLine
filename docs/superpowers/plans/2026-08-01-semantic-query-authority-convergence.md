# Semantic Query Authority Convergence

**Status:** Implementation complete; packaged Windows semantic evidence pending
**Created:** 2026-08-01
**Parent architecture:** `2026-07-17-mature-ide-responsiveness-architecture.md`

## Objective

Give Definition and Completion one production request boundary. The renderer
submits the current position and generations, rejects stale responses, and
renders the Broker result. Provider ordering, receiver context, index readiness,
degradation, and result provenance belong behind the Tauri command boundary.

## Previous Ownership

Definition previously queried the persistent definition index, then the
Language Runtime, then a renderer-side text fallback. Completion queried the
workspace semantic facade, the legacy Language Runtime, current-file symbols,
workspace symbols, and renderer keywords before merging results in React code.

Those paths had independent readiness and generation domains. A successful
result did not identify which authority won, and a fallback could hide a failed
semantic provider.

## Production Contract

The desktop renderer now uses two commands:

- `query_language_definition`
- `query_language_completion`

Both return a `LanguageQueryBrokerEnvelope<T>` containing:

- request and document generation;
- target generation when the winning provider can prove one;
- index readiness;
- winning provider and confidence;
- fallback use and miss reason;
- bounded explain evidence.

The old commands remain callable for IDE CLI compatibility, isolated tests, and
the non-Tauri demo runtime. They are not called by the ordinary desktop
Definition or Completion path when the Broker is available.

## Provider Policy

### Definition

1. Start the active Semantic Runtime and persisted definition facade concurrently.
2. Give semantic work a 180 ms foreground interaction budget.
3. Prefer semantic candidates that arrive inside the budget.
4. Otherwise return the persisted definition result with explicit deadline evidence.

### Completion

1. Start Semantic Runtime completion and persisted facade completion together.
2. Give semantic work an 80 ms foreground interaction budget.
3. Merge results that arrive inside the budget and deduplicate to 100 candidates.
4. Return persisted completion immediately when semantic work exceeds the budget.
5. Preserve language-service items before index items.
6. For member access, accept only methods, properties, fields, and other
   non-keyword/non-snippet semantic members.
7. Return no workspace-global or declaration keyword candidates after a dot.

The Rust receiver parser and Semantic Worker type engine remain the existing
authorities for identifying receiver type. The Broker coordinates them; it does
not add another parser.

## Generation Rules

- The renderer rejects a response whose request generation is not current.
- Completion also rejects a response for a different document generation.
- A semantic result reports its document generation as target generation only
  when one exists.
- An indexed fallback reports the durable served index generation.
- A semantic result never claims an unrelated SQLite generation.

## Degradation

- Semantic failure may use a ready persisted index and reports
  `fallbackUsed=true` with `semanticError` evidence.
- Semantic deadline exhaustion is normal degraded operation rather than an IPC failure.
- Query explain records `broker:indexMs`, `broker:semanticState`, and `broker:elapsedMs`.
- Missing or partial index state remains visible in readiness and miss reason.
- A desktop Broker miss does not trigger another renderer-side semantic query.
- `runtime:unavailable` is reserved for the non-Tauri demo runtime and permits
  its compatibility implementation to continue.
- Stale results cannot update completion items or start navigation.

## Execution Result

- [x] Added a typed cross-language Broker envelope.
- [x] Added Definition and Completion Tauri commands.
- [x] Routed desktop Definition through one Broker request.
- [x] Routed desktop Completion through one Broker request.
- [x] Prepared semantic and index completion work concurrently.
- [x] Enforced receiver-member filtering behind the Broker boundary.
- [x] Added request and document generation rejection in the renderer.
- [x] Preserved explicit non-desktop compatibility behavior.
- [x] Added source, confidence, fallback, miss, and explain evidence.
- [x] Preserved existing local, cross-file, SDK, ArkUI, and inferred-type tests.
- [x] Added packaged Ctrl+Click and receiver-member completion workloads.
- [x] Added strict semantic evidence, miss, negative-candidate, and latency gates.
- [x] Isolated foreground latency from cold semantic initialization with explicit deadlines.
- [x] Added bounded recent-document retention and idle type-engine preparation.
- [x] Added externally validated dependency-closure reuse and provider latency histograms.
- [x] Pinned the real-project repository, revision, license, and explicit SDK path.
- [x] Made native CodeMirror completion the only AppShell presentation and acceptance owner.
- [x] Kept semantic candidate filtering, ranking, generation rejection, and explain evidence at
      the Broker boundary.
- [ ] Capture packaged Windows Ctrl+Click and member-completion evidence against
      a pinned real SDK workspace.

## Acceptance

- Desktop Definition and Completion each issue one Tauri command.
- `receiver.` never presents declaration keywords or snippets.
- Local, imported, SDK, ArkUI, and typed definition behavior remains green.
- Superseded request or document generations publish no UI result.
- Semantic failure is distinguishable from an authoritative empty result.
- The editor remains usable while semantic or index readiness is partial.
- Packaged Windows completion p95 is at most 150 ms and Definition p95 is at
  most 200 ms on the pinned release machine.

The unchecked packaged item is release evidence. A macOS unit or browser test
cannot close it because it does not execute WebView2, Tauri IPC, the packaged
semantic sidecar, and the configured HarmonyOS SDK together.

Run that evidence through `windows-packaged-soak.yml` with the `medium` fixture
and a 30-minute duration. Its pinned real-project stage exercises receiver-member
completion and Ctrl+Click through the packaged executable and records strict
latency, semantic result, and miss-reason evidence.

## 2026-08-02 Latency Isolation Verification

- Semantic Worker: 62 tests passed, including idle preparation generation reuse.
- Foreground Broker: deadline and semantic-result tests passed.
- Frontend semantic synchronization: delayed open, latest-version preparation,
  12-document LRU retention, and eviction tests passed.
- Production frontend and Semantic Worker builds passed.
- The 500-line source limit passed across 885 files.
- Full frontend execution passed 1,365 of 1,366 tests before exposing a golden-corpus
  test path that depended on the process working directory; the corpus now resolves
  relative to its test module and passes from the repository root.

## Local Verification

Verified on 2026-08-01:

- Broker service tests: 2 passed.
- Definition and SDK definition tests: 22 passed.
- Semantic Worker tests: 60 passed.
- Focused Definition and Completion frontend tests: 37 passed.
- Frontend quality gate: 40 passed.
- Runtime performance gate: passed, with search input/delete p95 at 2.156 ms
  and file switching p95 at 0.978 ms.
- Rust formatting and the 500-line source limit: passed.
- Production frontend build: passed; the existing Vite large-chunk warning
  remains non-blocking.

The SDK definition fixture previously used a two-second test-only worker
timeout and could fail when many Node fixtures started concurrently. Its
test-only timeout is now five seconds; the production timeout remains three
seconds. The full 22-test Definition subset passes under parallel execution.

## 2026-08-02 Final Local Authority Verification

- Native CodeMirror is the sole AppShell completion presentation and acceptance path; the legacy
  controller and popup have no production import.
- The strict frontend gate passed 1,399 tests across 18 count-verified stages, including current
  caret Definition, SDK details, replacement ranges, snippets, lazy resolution, stale generations,
  settings-apply isolation, ranking, keyboard selection, and mouse acceptance.
- The semantic golden corpus passed 12 cases, including 5/5 exact Definition cases and all 15
  required completion candidates with zero forbidden-candidate violations.
- Production build, semantic bundle smoke, the 890-file line-count gate, and whitespace checks
  passed.
- The Rust gate passed 959 library tests plus seven sidecar integration tests with zero failures;
  11 explicit profiling or opt-in tests remained ignored.
- Local runtime evidence remains comfortably inside the interaction budgets: search input/delete
  p95 0.312 ms, file switching p95 0.144 ms, and jump dispatch p95 0.006 ms.

The implementation objective is complete locally. The unchecked packaged Windows acceptance item
remains open until `windows-packaged-soak.yml` records WebView2, Tauri IPC, semantic sidecar, real
SDK, executable hash, and latency evidence from the same release artifact.
