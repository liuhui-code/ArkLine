# Semantic Golden Corpus Phase 2

**Status:** Project type-propagation baseline complete
**Created:** 2026-08-02
**Parent:** `2026-08-02-semantic-golden-corpus-phase1.md`

## Objective

Prove that the semantic engine preserves project type identity across module
indirection and inferred receiver chains. Keep every case inside the versioned
corpus and execute it through the same public Semantic Worker protocol as the
Phase 1 baseline.

## Added Cases

- Definition through a barrel re-export and a renamed import alias, resolving
  to the original interface declaration.
- Completion through `Box<UserAccount>.value.` with concrete generic binding.
- Completion after `await loadAccount()` with the resolved Promise return type.

Both completion cases require `accountName` and `save` inside Top-5 and reject
keyword, snippet, modifier, and lifecycle leakage.

## Coverage Evidence

Corpus cases now declare required coverage tags. The structured report emits a
sorted, deduplicated union instead of asking CI or documentation to infer
coverage from case names.

Current report:

- 7 cases passed.
- Definition exact: 3/3.
- Completion required Top-5: 8/8.
- Forbidden candidates: 0.
- Coverage includes alias, ArkTS, async return, cross-file Definition, generic,
  import, member, re-export, same-file, `this` receiver, typed receiver, and
  TypeScript.

## Remaining Quality Boundary

This result proves the fixed project fixture only. It does not claim ArkUI or
real HarmonyOS SDK quality, overload ranking, Find Usages precision/recall,
signature help, import edits, CodeMirror acceptance parity, or packaged Windows
latency. Those remain separate vertical corpus slices so a failure identifies
one provider or interaction boundary.
