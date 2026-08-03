# ArkTS Virtual Document Source Maps

**Status:** Completion, Definition, and same-file completion edit mapping complete
**Created:** 2026-08-02
**Parent:** `2026-07-26-completion-responsiveness-architecture.md`

## Objective

Allow ArkLine's TypeScript-backed semantic engine to adapt ArkTS syntax without
letting generated-document coordinates escape into the editor or workspace.

## Implemented Contract

- `.ets` source is transformed into an internal virtual TypeScript document.
- Rewrites are represented as sparse ordered segments rather than per-character maps.
- Source query offsets map into generated content.
- Generated Definition offsets and Completion replacement spans map back to source ranges.
- TypeScript completion details resolve lazily through protocol v5.
- Safe same-file import edits map back to source ranges and carry the acknowledged document version.
- CodeMirror applies the primary completion and import edits as one checked transaction.
- TypeScript files use the same identity mapping boundary.
- The type-engine identity is `arkts-v2`, and worker health advertises `virtualDocuments`.
- Golden corpus coverage includes a non-length-preserving one-line ArkTS receiver case.

The first real rewrite changes `struct` to `class` without padding. This makes
coordinate correctness depend on the source map instead of accidental equal-length text.

## Invariants

1. The editor and Rust host only receive original `.ets` paths and coordinates.
2. A rewrite may change text length without changing Definition or Completion behavior.
3. Mapping is bounded by rewrite count, not document character count.
4. Type-engine cache identity changes when virtual-document semantics change.
5. Generated edits must not be applied until their ranges pass through this map.

## Remaining Slice

Completion code actions containing commands, new files, or changes outside the active file are
rejected by the same-file resolver. They must enter the existing workspace edit preview and
coordinator before they can be enabled. TypeScript snippet completions continue using native
CodeMirror tab stops and do not yet combine snippet placeholders with additional import edits.

## Verification

- Virtual document and semantic worker tests: 71/71 passed.
- Golden corpus: 12/12 cases, 5/5 exact definitions, 15/15 required Top-5 completions.
- Rust library suite (970 tests), strict frontend gate, and focused CodeMirror tests passed.
- Production semantic sidecar smoke test and frontend build passed with protocol v5.
- Source line-count and whitespace gates passed.
