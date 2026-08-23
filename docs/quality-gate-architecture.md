# ArkLine Quality Gate Architecture

## Objective

The gate protects merge and release decisions with repeatable evidence. It is
not a second build system and it must not hide a failed stage behind a green
summary. Every gate has named stages, bounded execution, a deterministic exit
code, and a JSON report that remains available after CI finishes.

## Industry alignment

ArkLine follows the GitHub Actions model in which required status checks block a
protected branch until they pass. The repository should require the stable
`Quality Gate / Fast` check on pull requests and `Windows / Package` for the
Windows product target. GitHub documents that required checks must pass before
a pull request can merge:

<https://docs.github.com/en/pull-requests/reference/status-checks>

The workflows use read-only `GITHUB_TOKEN` permissions for validation. Release
creation is isolated to the final job of the manual release workflow, whose
write permission is limited to `contents`. This follows GitHub's workflow
permission rule that nested workflows may only retain or reduce permissions:

<https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations>

Old non-`main` branch and pull-request runs are cancelled, while release and
packaged-soak workflows each serialize their runs. This avoids wasting runners
on obsolete commits without cancelling a release measurement halfway through.
Build outputs and test reports are uploaded as artifacts rather than placed in dependency caches;
GitHub explicitly distinguishes durable workflow artifacts from disposable
dependency caches:

<https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts>

## TDD control plane

The quality gate consumes two separate contracts. `docs/quality/capabilities.json`
maps product behavior to source and test patterns; `docs/quality/tdd-policy.md`
defines RED/GREEN evidence, test sizes, boundary mocking, and exception rules.
`pnpm test:inventory` measures the current test portfolio. On every branch and
pull request, `pnpm test:impact:advisory` records changed files, affected
capabilities, selected tests, selection rate, execution results, and any
fail-safe full-suite reason.

Stage 2 executes selected Frontend and semantic-worker tests plus conservative
Rust test groups as a non-blocking advisory before the normal fast gate. Rust
tests compile once, run by bounded domain filters, and fail closed if a filter
matches zero tests. Fail-safe full-suite plans remain delegated to
`pnpm check:fast`, which is authoritative. Afterward, CI reconciles both reports
at gate-step precision and records potential false negatives and false positives.
Unknown production files, global contracts, or an unavailable Git diff select
the full suite. Advisory execution may become blocking only after historical
eligible samples and injected failures demonstrate zero known false negatives.
Stage 3 assigns each GitHub run attempt a stable sample identity, extracts failed
test identities from Vitest and Rust runner output when available, and retains
the evidence for 90 days. The offline history aggregator deduplicates downloaded
artifacts and enforces the promotion thresholds defined by the TDD policy.
Stage 4 adds the independent `test-impact-evidence` workflow. It runs weekly or
on manual dispatch, downloads retained `windows-ci` and calibration evidence,
executes an identity-bearing controlled failure, aggregates the result, and
uploads the current calibration plus summary as separate 90-day artifacts.
Controlled samples have their own sample kind and do not count toward production
coverage.
Stage 5 converts the aggregate into a JSON and Markdown promotion review. The
scheduled workflow publishes the Markdown through `GITHUB_STEP_SUMMARY` and
retains both formats with the history artifact. Threshold qualification produces
`review-required`, never an automatic required check or blocking decision.

## Gate layers

| Layer | Trigger | Purpose | Blocking result |
| --- | --- | --- | --- |
| Fast | every branch push and PR | whitespace, file-size policy, semantic tests, focused frontend contract tests, Rust tests, production build, local interaction performance | blocks merge |
| Full | manual release candidate | complete frontend suite, Rust tests, build, strict interaction performance | blocks release creation |
| Windows package | every branch after fast | native Windows package and bundle shape verification | blocks Windows target |
| Packaged soak | manual release evidence | real packaged executable, index workload, search/navigation responsiveness, memory and queue health | blocks release claim when strict |
| Impact evidence | weekly or manual | historical advisory reconciliation and controlled-failure calibration | evidence only; does not block product CI |
| Impact promotion review | after evidence aggregation | auditable threshold status and human-review recommendation | never authorizes enforcement automatically |

The fast and full gates share one manifest and one Node runner. A failed stage
stops later stages, writes the failing command and exit information, and exits
non-zero. This keeps local and hosted decisions identical while still allowing
the Windows package and long soak to remain platform-specific. During a release,
the full gate is split into independent frontend and Rust lanes that run in
parallel with the native Windows portable build. The portable
bundle is unpacked and started against a pinned real Harmony project before it
becomes publishable.

## Required status checks and repository settings

Configure a protected `main` branch or repository ruleset with:

1. Require pull requests and at least one review.
2. Require `Quality Gate / Fast` and `Windows / Package` to pass.
3. Require branches to be up to date before merging when the repository has
   enough parallel changes to make merge skew material.
4. Disallow force-pushes and deletion of `main`.
5. Keep release publishing outside pull-request workflows. Manually dispatch
   `windows-exe-release` from the exact branch to release; the workflow creates
   the new tag at that SHA only after the frontend and Rust release lanes,
   Windows build, and packaged smoke check pass.

These branch settings are repository metadata and cannot be reliably enforced
by a source file alone. They must be checked once in the GitHub repository
settings and reviewed when workflow job names change.

## Failure evidence

Every CI gate uploads `artifacts/quality-gate-*.json`, TDD inventory, impact,
Rust selection, and reconciliation reports, plus the existing frontend,
packaged smoke, and packaged soak reports with `if: always()`. The report
contains schema version, gate name, start/end time, total duration, every stage,
exit code, signal, timeout, and the first failed stage. A green gate without a
report is a workflow defect.

## Long-term evolution

1. Accumulate 100 production samples and 5 identity-bearing failure samples, then
   review every false-negative and false-positive classification recorded by the
   promotion report before proposing a blocking affected-test gate.
2. Keep the manifest as the contract and add a schema test before changing a
   stage or required check name.
3. Add changed-code coverage and static analysis only when the project has a stable tool and
   a useful baseline; do not turn warning churn into an opaque merge blocker.
4. Promote packaged soak from manual to scheduled/nightly evidence before making
   it a required PR check. Its runtime and platform cost are inappropriate for
   every keystroke-sized change.
5. Add signed release attestations and dependency review when release trust or
   supply-chain requirements justify them. Keep those concerns separate from
   application correctness gates.
