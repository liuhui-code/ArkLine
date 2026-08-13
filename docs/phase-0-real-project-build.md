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
configuration. ArkLine now reports that condition during preflight and no
longer treats an unsigned HAP, APP, or HSP as a successful installable build.

## Signing Acceptance Gate

For every signable target, ArkLine inspects the selected product in
`build-profile.json5` before launching Hvigor. The product must reference an
`app.signingConfigs` entry whose type is `HarmonyOS`. Its material must define
`certpath`, `profile`, `storeFile`, `storePassword`, `keyAlias`, `keyPassword`,
and `signAlg`; the three referenced files must exist. Relative material paths
are resolved from the project root.

Passwords are checked only for presence. Their values are never returned from
the native inspection command or written to ArkLine logs.

After Hvigor exits successfully, ArkLine classifies filesystem artifacts using
Hvigor's output convention. A `-unsigned` or `_unsigned` HAP, APP, or HSP turns
the run into a failure with a signing-specific message. HAR artifacts remain
outside this gate because libraries are not application-signed packages.

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

## Remaining Limits

- Automatic DevEco Hvigor discovery is currently implemented for macOS paths.
- SDK API compatibility is still reported by Hvigor rather than parsed by ArkLine
  into a dedicated preflight diagnostic.
- Device installation and launch verification are outside this Phase 0 baseline.
- The real application stays outside this repository; deterministic unit tests
  cover environment selection and artifact verification inside the repository.
