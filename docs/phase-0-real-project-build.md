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

### Verified unsigned acceptance run

On 2026-08-15, the opt-in real-project acceptance test started from a fresh
copy with no package artifacts and exercised ArkLine's frontend build controller
for both `runBuild(true)` and `runBuild(false)`. The controller planned and ran
the real DevEco Hvigor commands, parsed diagnostics, scanned the filesystem, and
kept the signing warning attached to the completed run.

The clean path completed in 71.751 seconds. The incremental path completed in
15.814 seconds and reported `UP-TO-DATE`. Both runs verified the same non-empty
artifact receipt:

```text
entry/build/default/outputs/default/entry-default-unsigned.hap
size: 502305 bytes
sha256: 3c131233cf0c55947d02f357155b8ad27f0bafc9ab995c37ba751458d291c48d
signature: unsigned
```

The acceptance test is skipped by default because it requires a local HarmonyOS
project and DevEco Studio. Run it explicitly with:

```text
ARKLINE_REAL_BUILD_ROOT=<fresh-project-copy> \
ARKLINE_REAL_HVIGOR=<DevEco>/Contents/tools/hvigor/bin/hvigorw \
pnpm exec vitest run tests/frontend/verified-unsigned-build.real.test.tsx
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

- Windows discovery is covered by a cross-platform installation-shape test, but
  the full signed project build still needs execution on a Windows host with
  DevEco Studio installed.
- SDK compatibility preflight intentionally handles only explicit numeric API
  prefixes; unknown future version formats remain reported by Hvigor.
- Device installation and launch verification are outside this Phase 0 baseline.
- The real application stays outside this repository. The opt-in acceptance
  test supplies its path at runtime; deterministic tests cover the same contract
  without requiring DevEco Studio in ordinary CI.
