# Semantic Golden Corpus

The versioned corpus executes Definition and Completion through the public
`SemanticWorkerSession` protocol. It measures semantic answers, not private
parser helpers.

## Source Markers

Fixture source uses removable markers:

```ts
function /*@definition.local-function.target*/calculateTotal() {}
calculate/*@definition.local-function.query*/Total()
```

The runner copies the fixture into a temporary project, removes every marker,
and converts each marker offset into a one-based line and column. Imports and
dependency loading therefore use ordinary files with valid source content.

Marker ids must be unique across one corpus. Corpus references also name the
owning file so a moved or duplicated marker fails explicitly.

An optional `sdkDirectory` is materialized under a separate temporary root.
SDK markers use the `@sdk/` file prefix. The runner temporarily points
`ARKLINE_HARMONY_SDK_PATH` at that root and restores the previous value in its
cleanup path. A committed synthetic SDK proves provider behavior; it is not
release evidence for a real HarmonyOS SDK installation.

## Quality Rules

- Definition cases require the exact file, line, and column.
- Completion cases require every declared candidate inside their Top-K budget.
- Forbidden labels or kinds fail the case even when required candidates exist.
- A failure remains visible in `failedCases`; aggregate percentages cannot hide
  an incorrect user journey.
- Every case declares non-empty `coverage` tags. The report publishes their
  sorted union so CI evidence shows which semantic dimensions were exercised.

Run the gate with:

```bash
pnpm test:semantic-worker
```

The test emits one `ARKLINE_SEMANTIC_QUALITY` JSON record for CI evidence.
