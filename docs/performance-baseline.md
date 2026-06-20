# ArkLine Performance Baseline

## Measurement Policy

Record the machine, Windows build, project size, and whether the ArkTS language
server is enabled for every benchmark run.

## MVP Targets

| Metric | Target |
|---|---:|
| Cold start to editable window | <= 2.5 seconds |
| Idle memory without LSP | <= 160 MB |
| Total memory with LSP | <= 340 MB |
| Quick Open result update | <= 50 ms |
| Search first result | <= 300 ms |

## Current Local Status

Local verification on 2026-06-19 from the macOS implementation environment:

- `pnpm test`: passing
- `pnpm build`: passing
- Frontend bundle split after lazy-loading CodeMirror:
  - main entry chunk: about `204 kB` minified, `64.5 kB` gzip
  - editor chunk: about `441.5 kB` minified, `149.4 kB` gzip
- Windows executable and installer: not yet verified from a Windows host or
  `windows-latest` CI run

## Release Gate

Do not mark MVP complete until Windows measurements are captured against a real
ArkTS workspace and attached here.
