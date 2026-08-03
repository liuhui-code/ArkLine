# Semantic Golden Corpus Phase 3

**Status:** Synthetic ArkUI and SDK provider baseline complete
**Created:** 2026-08-02
**Parent:** `2026-08-02-semantic-golden-corpus-phase2.md`

## Objective

Bring ArkUI and HarmonyOS system declarations into the same deterministic
quality corpus as project semantics. Exercise public Semantic Worker requests
while keeping the SDK fixture isolated from the developer machine.

## SDK Fixture Contract

- The corpus declares an optional `sdkDirectory`.
- Project and SDK files are materialized under separate temporary roots.
- SDK marker references use an explicit `@sdk/` namespace.
- The runner installs the temporary SDK path only for one execution and restores
  the previous environment value in `finally`.
- The synthetic fixture contains only minimal declarations and metadata needed
  to prove provider behavior; no Huawei SDK content is redistributed.

## Added Cases

- `Column().` completion requires common `width` and `height` plus the
  component-specific `justifyContent` attribute.
- `Column().width(...)` Definition resolves to the SDK component declaration.
- `common.UIAbilityContext` Definition resolves to the `@ohos` declaration.
- A `common.UIAbilityContext` receiver completes `filesDir` and
  `terminateSelf` inside Top-5.

## Architecture Correction

Definition previously had a private `@ohos` module lookup, while the persistent
TypeScript Language Service used ordinary Node resolution. SDK receiver types
therefore degraded to `any`, preventing object-member completion.

The SDK candidate policy now lives in one module resolver shared by Definition
and the TypeScript host. The fix reuses the declaration file as type authority;
it does not add another string-based SDK member parser.

## Result

- Corpus: 11/11 cases passed.
- Definition exact: 5/5.
- Completion required Top-5: 13/13.
- Forbidden candidates: 0.
- Coverage now includes ArkUI, SDK, SDK member, system API, and provider paths.

## Remaining Boundary

The synthetic SDK is deterministic protocol evidence. A pinned real SDK and a
packaged Windows editor run remain required for release evidence, including
sidecar discovery, configured SDK selection, CodeMirror popup interaction,
completion acceptance, and Ctrl+Click navigation.
