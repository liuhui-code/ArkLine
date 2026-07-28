# Build Environment Architecture

ArkLine builds HarmonyOS projects through the project-owned `hvigorw` wrapper. The
wrapper must run in the project root, with a usable Node runtime and a validated
HarmonyOS SDK. The build process must not depend on the shell that happened to
launch the desktop app.

## Resolution Contract

`resolve_build_environment_command` produces one immutable resolution used by both
preflight and the Hvigor child process:

- `nodePath`: directory containing `node` or `node.exe`
- `sdkPath`: normalized SDK root containing `ets` and `toolchains`
- `pathEntries`: Node, SDK toolchains, SDK ets, and project `node_modules/.bin`
- `environment`: explicit variables injected into the child process
- `checks`: user-facing readiness details for Node and SDK

Resolution precedence is:

1. Explicit Settings paths.
2. ArkLine and DevEco-compatible process variables when auto-detect is enabled.
3. Node lookup through `which` or `where`, and ArkLine's supported DevEco SDK
   defaults.

An explicit invalid path is reported as invalid when it is the only configured
source. Auto-detection may recover from an invalid optional value only when a
valid fallback is available.

## Environment Variables

For a validated SDK, ArkLine injects these compatibility names with the
normalized SDK root:

- `ARKLINE_HARMONY_SDK_PATH`
- `HOS_SDK_HOME`
- `OHOS_SDK_HOME`
- `HARMONY_SDK_HOME`
- `DEVECO_SDK_HOME`

For Node, ArkLine injects `NODE_HOME` and `ARKLINE_NODE_PATH`, and prepends the
resolved directory to `PATH`. Existing process variables remain inherited by the
child. `NODE_PATH` is intentionally not set because it changes Node module
resolution and can break project-local dependencies.

## Execution Flow

```text
project selection
  -> inspect project root and hvigorw
  -> resolve build environment
  -> show Node/SDK checks in preflight
  -> create build plan
  -> run each Hvigor step from project root with structured program/args
  -> parse output and retain environment snapshot
```

Preflight and execution consume the same resolution. A build cannot start when
the wrapper, Node, or SDK check is unavailable. This avoids a false-positive
preflight followed by a Hvigor process that cannot see the configured variables.
Clean and Build are separate child processes. The executor stops after the first
failed step, and does not pass the plan through a shell `&&` chain. The readable
command string remains available for the UI and build history, while the process
runner receives an executable and an argument array.

## Project Configuration Discovery

Project metadata is authoritative when available:

- modules declared in `build-profile.json5` are merged with modules discovered
  from `src/main` directories;
- products are read from the JSON5 `products` array with comment and nested-array
  aware scanning;
- directory discovery remains a fallback for partially generated projects.

This keeps Build usable while a workspace tree is still loading and avoids
silently dropping a valid module just because its files are not currently
visible in the UI.

## Configuration Selection and Persistence

Project build configurations are stored under `.arkline/build-configurations.json`.
Each saved or selected configuration records `lastUsedAt`; opening the project
restores the newest configuration. Older files without this field remain
compatible: a single legacy configuration is restored, while multiple legacy
configurations leave the current project defaults unchanged until the user
selects one.

The precedence for effective build choices is:

1. The restored or explicitly selected project configuration.
2. Project metadata defaults from `build-profile.json5` and detected modules.
3. The built-in HAP/entry/default/debug fallback.

The current-file module inference only runs when no configuration is active.
Profile parsing may expand module and product options, but it cannot overwrite
an active configuration. Configuration writes are serialized and capture the
project root at the time of the user action, so fast project switching cannot
write settings into the wrong workspace.

## Maintenance Rules

- Keep environment discovery in the Rust build environment service.
- Keep command planning independent of machine-specific paths.
- Add new vendor variable aliases only in the resolver and its tests.
- Never put secrets or full environment dumps in build output.
- Keep project build configuration separate from global SDK settings.
- Preserve the project wrapper as the source of Hvigor version truth.

## Troubleshooting

When a build is blocked, inspect the Build panel preflight entries. The Node and
SDK rows show the exact source result. If the SDK row is invalid, configure the
directory that contains `ets` and `toolchains`, not an individual file. If the
wrapper is present but still fails, verify that the selected project root is the
directory containing `hvigorw`, `hvigorfile.ts`, and `build-profile.json5`.
