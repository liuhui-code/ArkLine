# Search File Reader Phase 53

## Goal

Move search preview and text-search file read wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-file-reader.ts` as the read policy boundary.
- Preserve active editor, open document, and backend read priority through the
  existing `readSearchFileForSearch` implementation.
- Ensure preview reads never fall back to backend file IO.
- Let fallback text search use the shared reader with backend reads allowed.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Default search reads can use backend files when content is not open.
- Preview reads pass `allowBackendRead=false` to avoid IO on selection changes.
- Existing fallback text search semantics remain unchanged.
- The controller no longer owns file read policy details.

## Follow-Up

The next controller boundary is option state and action assembly. After that,
remaining work should focus on broader runtime responsiveness rather than
mechanically shrinking files.
