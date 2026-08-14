# Phase 1 Build and Run Closure

Date: 2026-08-14

## Goal

Move ArkLine from producing a verified HarmonyOS artifact to a repeatable
Build-and-Run loop on a real project. A successful phase must prove dependency
readiness, signed artifact production, device installation, and application
launch. Each stage must fail fast and preserve actionable evidence.

## Engineering Principles

- Prefer the project wrapper and tools from one DevEco installation.
- Resolve one immutable environment before starting child processes.
- Restore dependencies only when project evidence says they are missing.
- Run restore, clean, and build as separate structured steps under one run ID.
- Stop after the first failed step; never report success without a non-empty,
  signed artifact for signable targets.
- Keep credentials project-owned and redact secret values from diagnostics.
- Record commands, tool sources, duration, diagnostics, and artifact paths.

These rules follow the same fail-fast, reproducible, and observable boundaries
used by mature Gradle, Bazel, and IDE build integrations without introducing a
new build engine around Hvigor.

## Delivery Slices

### Slice 1: Dependency Readiness — Implemented

Before planning Hvigor, ArkLine inspects project- and module-level
`oh-package.json5` files. If a manifest declares dependencies and its adjacent
`oh_modules` directory is missing, the resolved build environment must provide
ohpm. The plan then runs:

```text
<resolved-ohpm> install --all
```

Only a successful restore advances to Clean or Build. The restore uses the same
working directory, Node environment, run ID, cancellation path, output capture,
and failure semantics as Hvigor. Already-ready projects keep the ordinary
incremental path and do not run ohpm on every build.

Huawei documents that DevEco project synchronization performs `ohpm install`
for device projects and that declared shared-package dependencies are installed
into `oh_modules`:

- https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/agc-harmonyos-create-appproject
- https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-har-import

### Slice 2: Signed Windows Evidence — Next

- Run a real signed, multi-module project on a Windows host with DevEco Studio.
- Preserve the exact DevEco, Node, ohpm, Hvigor, SDK, command, duration, and
  artifact hash in a machine-readable report.
- Exercise missing dependency, incompatible SDK, invalid signing material,
  clean build, and incremental build cases.
- Treat hosted-runner simulation as regression evidence, not release evidence.

### Slice 3: Install and Launch

- Resolve `hdc` from the selected SDK toolchain.
- Select a device explicitly when more than one is connected.
- Install only a fresh artifact matching the active configuration.
- Launch the configured application and report install and launch separately.
- Stop before launch when build or install fails.

Huawei documents `hdc app install` as the command-line installation path:

- https://developer.huawei.com/consumer/cn/doc/doccenter-deveco-studio/ide-emulator-install-upload

### Slice 4: Reproducibility and Incremental Performance

- Fingerprint manifests, lockfiles, selected product/module/mode, SDK, Node,
  ohpm, and Hvigor versions.
- Invalidate freshness when any fingerprint input changes.
- Measure first build, no-change build, changed-source build, and clean build.
- Manage Hvigor daemon lifecycle only after correctness gates are stable.

### Slice 5: Reliability Gate

- Prove Stop terminates restore/Hvigor child trees without orphans.
- Add bounded timeouts and classify environment, dependency, compilation,
  signing, artifact, install, and launch failures.
- Keep a deterministic real-project smoke fixture plus Windows release-machine
  evidence.

## Phase Acceptance

Phase 1 is complete when a fresh Windows checkout can be opened in ArkLine and
the normal Build-and-Run action restores missing dependencies, produces a
signed artifact, installs it, launches it, and records reproducible evidence.
The second no-change build must use the incremental path. A failure at any stage
must identify that stage and allow a safe retry.

Remote caches, distributed execution, build-graph visualization, and a plugin
ecosystem remain out of scope until this closure is proven.
