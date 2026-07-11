# Search Entity Query Session Phase 33

## Goal

Move Search Everywhere entity candidate filtering, ordering, capping, and patch construction out of the main controller.

## Scope

- Add a layout-level entity query session helper.
- Keep existing indexed, legacy, and local query source behavior unchanged.
- Keep UI patching in the controller.
- Add focused helper tests.

## Non-goals

- Do not move entity async execution fully out yet.
- Do not change pagination behavior.
- Do not alter Search Everywhere UI rendering.

## Follow-up

Move entity async request selection into the entity query session and share it with pagination.

## Verification

- Run entity helper and search controller tests.
- Run production build.
- Run runtime responsiveness guard.
- Keep all touched code files below 500 lines.
