# Build Environment Architecture

ArkLine prefers a project-owned `hvigorw` wrapper. Projects created by current
DevEco Studio versions may not contain one, so auto-detection may fall back to
the `hvigorw` bundled with a supported DevEco Studio installation. Either
command runs in the project root with a usable Node runtime and validated
HarmonyOS SDK. The build process must not depend on the shell that happened to
launch the desktop app.

## Resolution Contract

`resolve_build_environment_command` produces one immutable resolution used by both
preflight and the Hvigor child process:

- `nodePath`: directory containing `node` or `node.exe`
- `sdkPath`: normalized SDK root containing `ets` and `toolchains`
- `sdkApiVersion`: installed API reported by the SDK component manifest when available
- `hvigorCommand`: project wrapper or an absolute DevEco Hvigor command
- `hvigorSource`: `project-wrapper` or `deveco`
- `pathEntries`: Node, SDK toolchains, SDK ets, and project `node_modules/.bin`
- `environment`: explicit variables injected into the child process
- `checks`: user-facing readiness details for Node and SDK

Resolution precedence is:

1. Explicit Settings paths.
2. ArkLine and DevEco-compatible process variables when auto-detect is enabled.
3. Node lookup through `which` or `where`, and ArkLine's supported DevEco SDK
   defaults.

Hvigor resolution is independent and ordered:

1. Executable wrapper in the canonical project root.
2. DevEco Studio bundled Hvigor when auto-detection is enabled.

DevEco candidates cover the supported macOS application bundle names and
Windows installations under the standard `Program Files` roots or the current
user's `LOCALAPPDATA/Programs` directory. A candidate is accepted only when its
bundled `hvigorw` or `hvigorw.bat` file exists.

When DevEco Hvigor is selected, its bundled Node and SDK are preferred over the
process `PATH` and SDK environment variables. This keeps all three build tools
on one DevEco installation and avoids version mixing. `NODE_HOME` points to the
Node installation root (the parent of `bin` on macOS, or the directory
containing `node.exe` on Windows), while `nodePath` and the injected `PATH`
entry point to the executable directory. For builds, `DEVECO_SDK_HOME` points
to the directory containing SDK version directories such as `default`; the
semantic SDK path continues to point to the `openharmony` leaf containing `ets`
and `toolchains`.

An explicit invalid path is reported as invalid when it is the only configured
source. Auto-detection may recover from an invalid optional value only when a
valid fallback is available.

## Canonical Project Model

`inspect_harmony_build_project_command` is the only authority for a native build
root. It accepts a workspace directory, module directory, or source file and
returns one immutable project model containing:

- the canonical root and platform wrapper command;
- root marker readiness;
- modules and the default module;
- products and the default product parsed from the project-level profile.

Project-level `build-profile.json5` is the root authority. Its `modules` entries
declare module names and `srcPath` locations relative to that root. A module-level
`build-profile.json5` can repeat `hvigorfile.ts` and other marker names, but it
does not declare the owning project module graph and must not become the build
root. Quoted and unquoted JSON5 property names are both supported.

The wrapper and individual marker files remain compatibility evidence for older
or incomplete projects, not the primary project-model discriminator. A selected
module directory or source file first resolves to its nearest owning
project-level profile; only then does the selection choose a module from that
model. The browser-visible file detector is provisional UI data only. It cannot
start environment discovery until the project is confirmed as a Harmony project.

All later stages consume `HarmonyBuildProject.rootPath`. Environment detection,
build configuration persistence, command planning, process `cwd`, and build
history must not independently infer another root. Configuration loads use a
generation guard so an older parent-workspace request cannot overwrite a newer
canonical-project result.

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
  -> inspect project root and resolve project/DevEco Hvigor
  -> resolve build environment
  -> show Node/SDK/ohpm checks in preflight
  -> create build plan
  -> restore missing ohpm dependencies when required
  -> run each Hvigor step from project root with structured program/args
  -> parse output and retain environment snapshot
```

## Dependency Readiness

Project and direct module `oh-package.json5` manifests are inspected before a
build. A manifest that declares `dependencies`, `devDependencies`, or
`dynamicDependencies` requires an adjacent `oh_modules` directory. When that
evidence is missing, environment resolution must find ohpm from the selected or
detected DevEco installation, with PATH as an auto-detect fallback.

The command planner prepends `ohpm install --all` only for that missing state.
It runs as a separate structured process under the build run ID, so output,
duration, cancellation, and failure are handled consistently. A failed restore
prevents Clean and Build. A ready project never performs an unconditional
dependency installation, preserving the normal incremental path.

Hvigor global options precede the task, matching the supported command-line
shape documented by Huawei:

```text
hvigorw --mode module -p module=entry@default -p product=default \
  -p buildMode=debug assembleHap --no-daemon
```

Clean and Build remain separate structured process requests. On Windows, both
direct executables and `.bat` wrappers are launched through the shared hidden
command factory with `CREATE_NO_WINDOW`; builds must not open transient console
windows.

Preflight and execution consume the same resolution. A build cannot start when
Hvigor, Node, or the SDK check is unavailable. This avoids a false-positive
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

Native inspection provides product defaults synchronously to `runBuild()`. The
first Build click therefore does not race the UI effect that opens
`build-profile.json5`. The frontend parser remains a browser-preview fallback.

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

Native inspection also reads each product's `compileSdkVersion`. The build
environment reads the selected SDK's API from an `oh-uni-package.json`
component manifest. When both values have a numeric API prefix and the product
requires a newer API, preflight blocks before Hvigor starts. Missing or unknown
future formats remain Hvigor-owned rather than becoming false ArkLine errors.

## Maintenance Rules

- Keep environment discovery in the Rust build environment service.
- Keep command planning independent of machine-specific paths.
- Add new vendor variable aliases only in the resolver and its tests.
- Never put secrets or full environment dumps in build output.
- Keep project build configuration separate from global SDK settings.
- Prefer the project wrapper as the source of Hvigor version truth; use the
  detected DevEco installation only when the project has no wrapper.
- Keep the realistic DevEco fixture under
  `src-tauri/src/services/fixtures/harmony-project` aligned with root and module
  profile shapes.
- Keep project-root tests aligned with DevEco's project-level `modules[].srcPath`
  contract, including projects without a wrapper and module-level profiles that
  repeat root marker filenames.
- Keep DevEco fallback explicit in the environment resolution and Build panel;
  never silently select an unrelated global `hvigor` from `PATH`.

Primary references:

- [Huawei Hvigor command examples](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/ide-hvigor-compilation-options-customizing-sample-V14)
- [Huawei project-level and module-level build-profile.json5](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/ide-hvigor-build-profile-V5)
- [OpenHarmony Stage project structure](https://gitee.com/openharmony/docs/blob/43d836fe05a882d386c6c42e3827221cd2051256/en/application-dev/quick-start/start-with-ets-stage.md)

## Troubleshooting

When a build is blocked, inspect the Build panel preflight entries. The Node and
SDK rows show the exact source result. If the SDK row is invalid, configure the
directory that contains `ets` and `toolchains`, not an individual file. If
project recognition fails, verify that the owning project-level
`build-profile.json5` declares at least one module with `name` and `srcPath`. A
module-level profile next to `entry/src/main` is not the application project
root, and a project-owned wrapper is optional when DevEco Hvigor is available.

Signing is optional for HAP, APP, and HSP compilation. Native project inspection
resolves the selected product's signing configuration and checks required
material without returning password values. Missing configuration or material
is a non-blocking warning. A successful Hvigor exit that produces an `unsigned`
package remains a successful build result and records its unsigned status so
install and launch workflows can reject it when signing is actually required.
The Build tool window keeps the warning visible after completion and renders an
artifact receipt with package kind, path, and conservative signature state.
Packages without explicit signing evidence are reported as `unknown`, never
silently promoted to `signed`.
