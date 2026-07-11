# Language Query Snapshot Store Phase 21

## Goal

Add a lightweight ring-buffer store for recent foreground language-query snapshot metadata.

## Current State

- Shared language-query snapshots expose content length and content class.
- No runtime component retains that metadata for diagnostics.
- Query Explain only records misses with explain evidence and is not suitable for all request samples.

## Plan

1. Add a small language-query snapshot store.
2. Record request kind, location, content length, content class, and creation time.
3. Keep the store independent from controllers in this phase.
4. Add focused tests for ordering, limit trimming, copy-safe snapshots, and clearing.
5. Run focused tests, build, perf, line-count checks, and commit.

## Acceptance

- Store has stable typed input/output.
- Store snapshots are newest-first and immutable by copy.
- Touched code files remain below 500 lines.
