# Semantic Golden Corpus Phase 1

**Status:** Core corpus foundation complete; real SDK and packaged editor E2E pending
**Created:** 2026-08-02
**Parent:** `2026-07-26-completion-responsiveness-architecture.md`

## Objective

Replace isolated semantic examples with one versioned, executable quality
corpus. The first slice proves exact Definition and receiver-member Completion
through the public Semantic Worker protocol and makes failures visible in the
ordinary semantic quality gate.

## Contract

- Fixture source owns stable removable query and target markers.
- The runner materializes valid source into a temporary project.
- Definition requires an exact file, line, and column.
- Completion requires declared candidates inside a bounded Top-K page.
- Forbidden labels and kinds are hard failures.
- Reports retain every failed case and emit structured CI evidence.

## Implemented Cases

- Same-file function Definition.
- Imported interface-property Definition.
- Typed TypeScript receiver property and method Completion.
- ArkTS `this.` property and method Completion.
- ArkTS receiver exclusion for declaration keywords, snippets, and the
  lifecycle `build` method.

The lifecycle exclusion is enforced in both the Semantic Worker and the Rust
Language Query Broker, so persisted-index fallback cannot reintroduce it.
Ordinary TypeScript `.ts` receivers may still expose a legitimate `build`
member.

## Result

- Definition exact: 2/2.
- Completion required Top-5: 4/4.
- Forbidden receiver candidates: 0.
- Golden Corpus focused test: passed.
- Language Query Broker receiver-filter test: passed.

## Next Corpus Slice

Add versioned cases one vertical behavior at a time for re-exports, aliases,
generic chains, async returns, overloads, ArkUI APIs, SDK definitions, usages,
signature help, and import edits. A redistributable synthetic SDK fixture may
guard protocol behavior, but release claims require a pinned real SDK identity
and packaged Windows editor interaction evidence.
