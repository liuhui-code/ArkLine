# ArkLine ArkUI System API Semantic Design

## Problem

ArkLine can route editor jump and completion requests into the semantic worker, but the worker currently understands only a narrow symbol model:

- declarations in the current document
- declarations in other workspace files
- declarations from explicitly imported `@ohos.*` SDK modules

ArkUI component attributes such as `.width(100)` are not imported from a module in normal ArkTS UI DSL code. They come from the HarmonyOS SDK component declarations and component metadata. As a result, clicking `width` returns no definition, and completion after a component chain does not suggest system attributes.

## Evidence

Current minimal reproduction:

```ets
Column() {
  Text("Hi")
}
.width(100)
```

The current semantic worker returns:

```text
gotoDefinition(width) => null
completion => @Entry, @Component, build()
```

Local DevEco Studio SDK contains the needed data:

- `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/component/common.d.ts`
- `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/components/common_attrs.json`
- `/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/ets/build-tools/ets-loader/components/*.json`

`common.d.ts` declares `CommonMethod<T>.width(...)`, while `common_attrs.json` declares `width` as a universal ArkUI attribute. Component JSON files add component-specific attributes, for example `Column` owns `alignItems`, `justifyContent`, and `reverse`.

Official HarmonyOS reference documentation classifies `width` under ArkUI universal attributes and describes the signature `width(value: Length): T`.

## Goal

Add a lightweight ArkUI system API index to the semantic worker so ArkLine can jump to and complete ArkUI component/system APIs such as `width`, while preserving existing workspace and imported SDK behavior.

## Non-Goals

- Do not implement a full ArkTS typechecker.
- Do not embed DevEco Studio jars or depend on IntelliJ internals.
- Do not add network-backed documentation lookup at runtime.
- Do not replace the existing semantic worker protocol.

## Design

### ArkUI API Index

Create a semantic worker module that loads ArkUI metadata from the configured HarmonyOS SDK:

- `ets/component/common.d.ts` for universal method declarations and JSDoc.
- `ets/component/*.d.ts` for component-specific method declarations.
- `ets/build-tools/ets-loader/components/common_attrs.json` for universal attribute names.
- `ets/build-tools/ets-loader/components/*.json` for component-specific attribute names.

The index should expose:

```ts
type ArkuiApiEntry = {
  name: string
  kind: "universalAttribute" | "componentAttribute"
  component?: string
  path: string
  line: number
  column: number
  signature: string
  detail: string
}
```

The index is loaded lazily and cached per SDK root. Missing SDK files must produce an empty index rather than failing the semantic worker.

### Declaration Parsing

Extend document analysis for SDK declaration files to collect class/interface method members such as:

```ts
width(value: Length): T;
fontSize(value: Length): T;
```

The parser should keep the implementation intentionally narrow:

- match method declarations ending in `;`
- capture method name, signature, line, and column
- optionally capture the closest preceding JSDoc summary for completion detail

This is enough for SDK component declaration files without creating a full TypeScript parser dependency.

### Definition Resolution

For a symbol like `width`, definition resolution should use this order:

1. current document declarations
2. explicitly imported HarmonyOS SDK declarations
3. ArkUI system API index
4. workspace declarations
5. no result

This preserves local behavior while adding the missing system API fallback. Project-local declarations keep priority over ArkUI attributes when they are in the current file or imported module context.

### Completion Resolution

Completion should remain context-aware:

- In ordinary code, keep existing decorators, `build()`, and workspace functions.
- In ArkUI component-chain context, append ArkUI attributes.
- If the preceding chain can identify a component constructor, include both common attributes and that component's private attributes.

Examples:

```ets
Column() {
}
.wi
```

Expected completion includes:

- `width(value: Length): T`
- `height(value: Length): T`
- `justifyContent(...)` for `Column`

```ets
Text("Hi").
```

Expected completion includes:

- `width(value: Length): T`
- `fontSize(...)`
- `fontColor(...)`

The first implementation can use ArkTS UI DSL heuristics rather than full type inference:

- detect property access or completion after a component call chain
- inspect the nearest receiver expression for built-in component names
- fall back to common attributes when component detection is uncertain

### Frontend Integration

No major frontend architecture change is required. `AppShell` already routes go-to-definition and completion through the workspace API. Once the semantic worker returns SDK definition targets and completion items, existing editor selection, overlay, and status flows should work.

The only expected frontend follow-up is regression coverage for:

- clicking `width` opens the SDK declaration target
- completion overlay shows ArkUI system attributes
- Settings applying still blocks jump/completion until semantic refresh succeeds

## Testing Strategy

Semantic worker tests should cover the core behavior with temporary SDK fixtures:

- `gotoDefinition` on `.width(100)` resolves to `ets/component/common.d.ts`
- completion after `Column().` includes `width` and `justifyContent`
- completion after `Text().` includes `width` and `fontSize`
- project/import definitions still outrank system attributes where applicable
- missing SDK returns empty system entries without crashing

Frontend tests should cover that returned SDK targets are opened through the existing editor flow and that completion items render and can be accepted.

## Risks

- SDK declaration files are large; indexing must be lazy and cached.
- Naive context detection may over-suggest ArkUI attributes in ordinary TypeScript expressions.
- Multiple overloads such as `width(value: Length)` and `width(widthValue: Length | LayoutPolicy)` need deterministic first-target behavior while preserving useful detail.

## Acceptance Criteria

- Ctrl/Cmd-click on `width` in a normal ArkTS component chain resolves to SDK `common.d.ts`.
- Completion after ArkUI component chains includes common and component-specific attributes.
- Existing workspace definition and completion tests keep passing.
- Missing or invalid SDK paths degrade gracefully.
