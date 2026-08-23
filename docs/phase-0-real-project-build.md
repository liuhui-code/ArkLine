# Phase 0 Real Project Build Baseline

Date: 2026-08-13

Phase 0 proves that ArkLine's build contract can produce and verify a real
HarmonyOS application artifact. A zero exit code without a non-empty artifact
does not count as success.

## Baseline

The baseline used a temporary copy of an existing single-module HarmonyOS
application. The original project was not modified. Its SDK declaration was
changed only in the temporary copy from API 18 to the locally installed API 24,
because this machine does not have the API 18 SDK components.

Toolchain:

- DevEco Studio bundled command-line tools
- Hvigor 6.24.2
- Node.js 18.20.1 from the same DevEco installation
- ohpm 6.1.2.268
- HarmonyOS SDK 6.1.1.125, API 24
- module `entry`, product `default`, debug HAP

The verified command contract was:

```text
DEVECO_SDK_HOME=<DevEco>/Contents/sdk
NODE_HOME=<DevEco>/Contents/tools/node
PATH=<DevEco>/Contents/tools/node/bin:...
<DevEco>/Contents/tools/hvigor/bin/hvigorw \
  --mode module \
  -p module=entry@default \
  -p product=default \
  -p buildMode=debug \
  assembleHap \
  --no-daemon
```

Dependency restoration completed with the DevEco-bundled `ohpm install --all`.
Phase 1 now automates this step when a project or module declares dependencies
but its `oh_modules` installation evidence is missing.

## Evidence

Clean completed successfully in 5.640 seconds. The subsequent non-daemon build
completed successfully in 36.334 seconds and produced:

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
```

The artifact was non-empty (approximately 491 KiB). A following build also
completed successfully and reported `UP-TO-DATE` tasks, proving the ordinary
incremental path.

The initial artifact was unsigned because the sample has no signing
configuration. ArkLine reports that condition as a non-blocking preflight
warning and records the artifact as unsigned. The build itself succeeds, while
install and launch workflows can still require a signed artifact.

### Controller-layer unsigned acceptance run

On 2026-08-15, the opt-in real-project controller test started from a fresh
copy with no package artifacts and exercised ArkLine's frontend build controller
for both `runBuild(true)` and `runBuild(false)`. It runs the real DevEco Hvigor
commands, while native project inspection, environment resolution, terminal IPC,
and artifact discovery are supplied by the test harness. This is controller and
command-contract evidence, not a native production-path test.

The clean path completed in 38.988 seconds. The incremental path completed in
8.420 seconds and reported `UP-TO-DATE`. Both runs verified the same non-empty
artifact receipt:

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
size: 502305 bytes
sha256: 8336d92ae5f1a2e93996a364df17f0360b7ca9a0d0fdfbec6b9fb6bfefe7237b
signature: unsigned
```

The acceptance test is skipped by default because it requires a local HarmonyOS
project and DevEco Studio. Run it explicitly with:

```text
ARKLINE_REAL_BUILD_ROOT=<fresh-project-copy> \
ARKLINE_REAL_HVIGOR=<DevEco>/Contents/tools/hvigor/bin/hvigorw \
pnpm exec vitest run tests/frontend/verified-unsigned-build.real.test.tsx
```

### Native production-service acceptance run

On 2026-08-15, a second opt-in acceptance test exercised the production Rust
services for project-root inspection, DevEco environment resolution, structured
terminal execution, and bounded artifact discovery. It used a disposable copy
of the real project; the original project was not modified. The copy's API 18
declaration was changed to `6.1.1(24)`, matching the installed HMS SDK metadata.

The native clean build completed in 36.222 seconds. The following incremental
build completed in 9.316 seconds and reported `UP-TO-DATE`. Production artifact
discovery returned the non-empty unsigned HAP at:

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
```

Run the native acceptance test explicitly with a disposable project path:

```text
ARKLINE_REAL_BUILD_ROOT=<fresh-project-copy> \
cargo test --manifest-path src-tauri/Cargo.toml --lib \
  services::build_project_service::tests::builds_a_real_unsigned_project_through_native_services \
  -- --ignored --exact --nocapture
```

## Signing Readiness Advisory

For every signable target, ArkLine inspects the selected product in
`build-profile.json5` before launching Hvigor. The product can reference an
`app.signingConfigs` entry whose type is `HarmonyOS`. Its material must define
`certpath`, `profile`, `storeFile`, `storePassword`, `keyAlias`, `keyPassword`,
and `signAlg`; the three referenced files must exist when signing is enabled.
Relative material paths are resolved from the project root.

Passwords are checked only for presence. Their values are never returned from
the native inspection command or written to ArkLine logs.

After Hvigor exits successfully, ArkLine classifies filesystem artifacts using
Hvigor's output convention. A `-unsigned` or `_unsigned` HAP, APP, or HSP remains
a successful build artifact with `unsigned` signature metadata. HAR artifacts
remain `not-applicable` because libraries are not application-signed packages.

Real-device signing material remains project-owned. Configure it through
DevEco Studio or directly in `build-profile.json5`; ArkLine does not generate,
copy, or persist private keys.

## Regressions Closed

- Projects without a project-owned wrapper can use detected DevEco Hvigor.
- DevEco Hvigor uses its matching bundled Node before arbitrary `PATH` Node.
- `NODE_HOME` uses the installation root rather than the executable directory.
- `DEVECO_SDK_HOME` uses the SDK container root rather than the semantic SDK leaf.
- Build planning receives the exact Hvigor command selected by preflight.
- Successful Hvigor completion is followed by a bounded filesystem artifact scan.
- A missing or empty expected artifact changes the ArkLine build result to failed.
- Windows auto-detection checks standard system and per-user DevEco Studio
  installations for `hvigorw.bat`.
- Selecting bundled DevEco Hvigor now resolves Node and the HarmonyOS SDK from
  that same installation on both macOS and Windows.
- ArkLine compares the selected product's `compileSdkVersion` with the installed
  SDK component `apiVersion` and blocks a known-incompatible build before Hvigor.

## Remaining Limits

- The controller-layer and native production-service acceptance tests cover the
  two sides of the Tauri IPC boundary. A packaged UI automation run that clicks
  Build remains release-level evidence rather than a Phase 0 code gate.
- Windows discovery is covered by a cross-platform installation-shape test, but
  the full signed project build still needs execution on a Windows host with
  DevEco Studio installed.
- SDK compatibility preflight intentionally handles only explicit numeric API
  prefixes; unknown future version formats remain reported by Hvigor.
- Device installation and launch verification are outside this Phase 0 baseline.
- The real application stays outside this repository. The opt-in acceptance
  test supplies its path at runtime; deterministic tests cover the same contract
  without requiring DevEco Studio in ordinary CI.
