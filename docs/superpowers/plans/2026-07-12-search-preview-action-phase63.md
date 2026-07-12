# Search Preview Action Phase 63

## Goal

Move selected-preview action wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-preview-action.ts` as the preview action adapter.
- Preserve text-result preview scheduling through the shared search file reader.
- Preserve Search Everywhere entity-mode preview clearing.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Text result selection still schedules a delayed preview read.
- Preview reads still pass through the shared reader with backend reads disabled.
- Entity mode still clears preview content instead of loading file preview.
- Controller no longer owns preview action dependency assembly.

## Follow-Up

Future hover, keyboard selection, and preview throttling changes should start in
this action adapter or the lower-level preview session.
