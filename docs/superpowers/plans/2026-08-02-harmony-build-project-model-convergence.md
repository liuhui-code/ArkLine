# Harmony Build Project Model Convergence

**Status:** Implemented and gated on 2026-08-02.

## Goal

Make selecting a Harmony project directory or a file inside a module sufficient
for one-click Build. Project inspection, environment checks, configuration,
planning, and execution must agree on one canonical project model.

## Decisions

1. Rust native inspection is the project-model authority.
2. Module package markers are weak; the project wrapper and root build markers
   outrank them.
3. Modules, products, and defaults are returned in one inspection result.
4. Environment resolution and terminal `cwd` consume the canonical root without
   re-deriving it.
5. Build configuration loads and saves use the canonical root and discard stale
   asynchronous loads.
6. Hvigor uses structured `program` and `args`; global options precede the task.
7. The project-pinned wrapper remains the default version authority.
8. Windows child processes use the shared no-console command factory.

## Implemented Slices

- Regression: module `oh-package.json5` no longer captures project root.
- Native model: `products` and `defaultProduct` are parsed from project profile.
- First click: module/product defaults are applied from the immediate inspect
  result before preflight and plan creation.
- Nested workspace: environment and configuration calls only use canonical root.
- Diagnostics: missing wrapper reports the canonical root; Unix permission errors
  include the executable-bit repair.
- Planner: commands match the documented Hvigor option/task ordering.
- Fixture: a realistic root/module DevEco structure exercises source-file inspect.

## Gate

- Rust build project and environment service tests.
- Frontend build controller, project detector, profile parser, domain, and tool
  window tests.
- TypeScript production build.
- Rust formatting, repository line-count gate, and `git diff --check`.

## Deferred Boundary

DevEco command-line-tools may provide an external Hvigor executable. Supporting
that safely requires an explicit execution-source field, precedence rules, and
version diagnostics. It must not be introduced as an unreported fallback because
that would make builds non-reproducible when a project wrapper is missing.
